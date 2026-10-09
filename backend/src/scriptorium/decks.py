"""Tome read/write layer (VEG-223, builds on ADR 0018).

CRUD over the ``decks`` and ``deck_cards`` tables (migration 0006). A Tome is a
``decks`` row plus one slot row per (printing, finish, board) with a quantity.
Slot reads join ``cards`` and attach the same nested ``card`` display object
that :mod:`scriptorium.inventory` uses, so the Tome editor needs no extra
round-trip per row.

The schema has no triggers, so this module owns two rules the database cannot
enforce on its own:

* Every deck write and every slot write sets ``decks.updated_at`` in the same
  transaction, through :func:`_touch`.
* A slot conflict (a second copy of a commander or companion, or a slot PATCH
  that would land on a tuple the Tome already holds) raises
  :class:`SlotConflictError` before the write, so the router answers 409 with a
  useful message instead of relaying a bare CHECK or UNIQUE failure.
* A slot write that would claim copies another claiming Tome already holds
  raises :class:`~scriptorium.reservations.ReservationConflictError` (ADR
  0020).

Slot writes issue ``BEGIN IMMEDIATE`` before any of these checks, so no other
writer can change what they read before the write lands. A refused write rolls
back and leaves no transaction open.

:func:`breakdown` is the owned-versus-needed view, built on the reference query
that ``tests/test_schema_decks.py`` pins.

Write functions commit their own transaction and roll back on a database error.
All functions expect a connection opened via :func:`scriptorium.db.connect`
(``row_factory = sqlite3.Row`` with foreign keys enforced).
"""

from __future__ import annotations

import json
import sqlite3
from typing import Any

from scriptorium import reservations
from scriptorium.inventory import owned_across_printings

# Deck columns PATCH may change. A fixed allowlist, so a caller's key never
# reaches the SQL as a column name.
_DECK_UPDATABLE_COLUMNS = ("name", "format", "status", "claims_cards", "notes", "changelog")

# Slot columns PATCH may change.
_SLOT_UPDATABLE_COLUMNS = ("quantity", "scryfall_id", "finish", "board")

# Boards that hold exactly one copy per slot (the schema CHECK).
SINGLETON_BOARDS = frozenset({"commander", "companion"})

# Card display fields nested under ``card`` on each slot. Same shape as an
# inventory lot's ``card`` object.
_CARD_DISPLAY_COLUMNS = (
    "name",
    "set_code",
    "set_name",
    "collector_number",
    "rarity",
    "image_uris",
)

_DECK_COLUMNS = (
    "id",
    "name",
    "format",
    "status",
    "claims_cards",
    "notes",
    "changelog",
    "created_at",
    "updated_at",
)

_NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%SZ', 'now')"


def _board_rank(column: str) -> str:
    """SQL ranking boards in reading order: commander, companion, main, side, maybe."""
    return (
        f"CASE {column} WHEN 'commander' THEN 0 WHEN 'companion' THEN 1 "
        "WHEN 'main' THEN 2 WHEN 'sideboard' THEN 3 ELSE 4 END"
    )


_CARD_SELECT = ", ".join(f"c.{col} AS card_{col}" for col in _CARD_DISPLAY_COLUMNS)

_SLOT_SELECT = (
    "SELECT dc.id, dc.deck_id, dc.scryfall_id, dc.finish, dc.board, dc.quantity, "
    + _CARD_SELECT
    + " FROM deck_cards dc JOIN cards c ON c.scryfall_id = dc.scryfall_id"
)

# Owned versus needed for one Tome. This is the reference query from
# tests/test_schema_decks.py with two changes. The owned and claimed_elsewhere
# CTEs only aggregate the Tome's own printings, because no other row can join.
# The final SELECT carries the card display columns and orders lines the way
# get_deck orders slots.
#
# Owned copies match on (scryfall_id, finish). Other claiming Tomes take their
# share first (claimed_elsewhere). This Tome's own demand for a folio is then
# allocated in a fixed order (commander, companion, main, sideboard, then slot
# id), so the same folio in two boards is not counted twice. Maybeboard rows
# neither claim nor consume.
_BREAKDOWN_SQL = f"""
WITH owned AS (
  SELECT scryfall_id, finish, SUM(quantity) AS n
  FROM inventory
  WHERE scryfall_id IN (SELECT scryfall_id FROM deck_cards WHERE deck_id = :deck)
  GROUP BY scryfall_id, finish),
claimed_elsewhere AS (
  SELECT dc.scryfall_id, dc.finish, SUM(dc.quantity) AS n
  FROM deck_cards dc JOIN decks d ON d.id = dc.deck_id
  WHERE d.claims_cards = 1 AND d.id <> :deck AND dc.board <> 'maybeboard'
    AND dc.scryfall_id IN (SELECT scryfall_id FROM deck_cards WHERE deck_id = :deck)
  GROUP BY dc.scryfall_id, dc.finish),
slots AS (
  SELECT dc.id, dc.board, dc.scryfall_id, dc.finish, dc.quantity,
         COALESCE(o.n, 0) AS owned,
         MAX(0, COALESCE(o.n, 0) - COALESCE(ce.n, 0)) AS available,
         SUM(dc.quantity) OVER (
           PARTITION BY dc.scryfall_id, dc.finish
           ORDER BY {_board_rank("dc.board")}, dc.id
           ROWS UNBOUNDED PRECEDING) AS demand_through_here
  FROM deck_cards dc
  LEFT JOIN owned o ON o.scryfall_id = dc.scryfall_id AND o.finish = dc.finish
  LEFT JOIN claimed_elsewhere ce ON ce.scryfall_id = dc.scryfall_id AND ce.finish = dc.finish
  WHERE dc.deck_id = :deck AND dc.board <> 'maybeboard')
SELECT s.id, s.board, s.scryfall_id, s.finish, s.quantity, s.owned, s.available,
       MIN(s.quantity, MAX(0, s.available - (s.demand_through_here - s.quantity))) AS have,
       s.quantity
         - MIN(s.quantity, MAX(0, s.available - (s.demand_through_here - s.quantity))) AS needed,
       {_CARD_SELECT}
FROM slots s JOIN cards c ON c.scryfall_id = s.scryfall_id
ORDER BY {_board_rank("s.board")}, c.name, s.id
"""


class SlotConflictError(Exception):
    """A slot write the Tome's rules refuse; the router answers 409.

    ``existing_slot_id`` names the slot already holding the tuple when the
    conflict is a collision, and is ``None`` when the write breaks the
    one-copy rule for commander and companion.
    """

    def __init__(self, message: str, *, existing_slot_id: int | None = None) -> None:
        super().__init__(message)
        self.existing_slot_id = existing_slot_id


# --- row shaping ------------------------------------------------------------


def _row_to_deck(row: sqlite3.Row) -> dict[str, Any]:
    """Turn a ``decks`` row into a dict, with ``claims_cards`` as a bool."""
    record = dict(row)
    record["claims_cards"] = bool(record["claims_cards"])
    return record


def _split_card(record: dict[str, Any]) -> dict[str, Any]:
    """Pop the ``card_`` prefixed columns off ``record`` into a nested ``card``."""
    card: dict[str, Any] = {col: record.pop(f"card_{col}") for col in _CARD_DISPLAY_COLUMNS}
    if card["image_uris"] is not None:
        card["image_uris"] = json.loads(card["image_uris"])
    record["card"] = card
    return record


def _row_to_slot(row: sqlite3.Row) -> dict[str, Any]:
    return _split_card(dict(row))


# --- helpers ----------------------------------------------------------------


def _touch(conn: sqlite3.Connection, deck_id: int) -> None:
    """Stamp ``decks.updated_at`` in the caller's open transaction (no commit)."""
    conn.execute(f"UPDATE decks SET updated_at = {_NOW_SQL} WHERE id = ?", (deck_id,))


def deck_exists(conn: sqlite3.Connection, deck_id: int) -> bool:
    """Whether a Tome with this id exists."""
    return conn.execute("SELECT 1 FROM decks WHERE id = ?", (deck_id,)).fetchone() is not None


def _get_deck_row(conn: sqlite3.Connection, deck_id: int) -> dict[str, Any] | None:
    row = conn.execute(
        f"SELECT {', '.join(_DECK_COLUMNS)} FROM decks WHERE id = ?", (deck_id,)
    ).fetchone()
    return _row_to_deck(row) if row is not None else None


def _require_deck_row(conn: sqlite3.Connection, deck_id: int) -> dict[str, Any]:
    deck = _get_deck_row(conn, deck_id)
    if deck is None:  # pragma: no cover - the row was just written and committed
        raise RuntimeError(f"deck {deck_id} could not be read back after a write")
    return deck


def get_slot(conn: sqlite3.Connection, deck_id: int, slot_id: int) -> dict[str, Any] | None:
    """Return one slot of one Tome (enriched), or ``None`` if it isn't that Tome's."""
    row = conn.execute(
        f"{_SLOT_SELECT} WHERE dc.id = ? AND dc.deck_id = ?", (slot_id, deck_id)
    ).fetchone()
    return _row_to_slot(row) if row is not None else None


def _require_slot(conn: sqlite3.Connection, deck_id: int, slot_id: int) -> dict[str, Any]:
    slot = get_slot(conn, deck_id, slot_id)
    if slot is None:  # pragma: no cover - the row was just written and committed
        raise RuntimeError(f"slot {slot_id} could not be read back after a write")
    return slot


def _slot_id_for(
    conn: sqlite3.Connection, deck_id: int, scryfall_id: str, finish: str, board: str
) -> int | None:
    """The id of the slot holding this tuple in this Tome, if any."""
    row = conn.execute(
        "SELECT id FROM deck_cards "
        "WHERE deck_id = ? AND scryfall_id = ? AND finish = ? AND board = ?",
        (deck_id, scryfall_id, finish, board),
    ).fetchone()
    return int(row[0]) if row is not None else None


# --- decks ------------------------------------------------------------------


def create_deck(
    conn: sqlite3.Connection,
    *,
    name: str,
    format: str | None = None,
    status: str = "in_progress",
    claims_cards: bool = True,
    notes: str | None = None,
    changelog: str | None = None,
) -> dict[str, Any]:
    """Bind a new Tome and return it. Both timestamps come from the schema default.

    The caller trims ``name`` and normalizes ``format`` (the API models do).
    """
    try:
        cur = conn.execute(
            "INSERT INTO decks (name, format, status, claims_cards, notes, changelog) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (name, format, status, int(claims_cards), notes, changelog),
        )
    except sqlite3.Error:
        conn.rollback()
        raise
    conn.commit()
    deck_id = cur.lastrowid
    if deck_id is None:  # pragma: no cover - sqlite always reports a rowid here
        raise RuntimeError("INSERT into decks returned no row id")
    return _require_deck_row(conn, deck_id)


def list_decks(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    """Every Tome, newest (highest id) first, each with its ``card_count``.

    ``card_count`` sums slot quantities across every board except maybeboard.
    """
    deck_cols = ", ".join(f"d.{col}" for col in _DECK_COLUMNS)
    rows = conn.execute(
        f"SELECT {deck_cols}, "
        "COALESCE(SUM(CASE WHEN dc.board <> 'maybeboard' THEN dc.quantity END), 0) "
        "AS card_count "
        "FROM decks d LEFT JOIN deck_cards dc ON dc.deck_id = d.id "
        "GROUP BY d.id ORDER BY d.id DESC"
    ).fetchall()
    return [_row_to_deck(row) for row in rows]


def get_deck(conn: sqlite3.Connection, deck_id: int) -> dict[str, Any] | None:
    """One Tome with its ``cards``, or ``None`` if absent.

    Slots are ordered by board (commander, companion, main, sideboard,
    maybeboard), then card name, then slot id.
    """
    deck = _get_deck_row(conn, deck_id)
    if deck is None:
        return None
    rows = conn.execute(
        f"{_SLOT_SELECT} WHERE dc.deck_id = ? ORDER BY {_board_rank('dc.board')}, c.name, dc.id",
        (deck_id,),
    ).fetchall()
    deck["cards"] = [_row_to_slot(row) for row in rows]
    return deck


def update_deck(
    conn: sqlite3.Connection, deck_id: int, updates: dict[str, Any]
) -> dict[str, Any] | None:
    """Apply ``updates`` to a Tome and return it (without slots), or ``None`` if absent.

    Only the columns in :data:`_DECK_UPDATABLE_COLUMNS` are written; any other
    key is ignored. An empty (or fully ignored) ``updates`` is a no-op that
    leaves ``updated_at`` alone.
    """
    fields = {col: updates[col] for col in _DECK_UPDATABLE_COLUMNS if col in updates}
    if "claims_cards" in fields:
        fields["claims_cards"] = int(fields["claims_cards"])
    if not fields:
        return _get_deck_row(conn, deck_id)
    assignments = ", ".join(f"{col} = ?" for col in fields)
    try:
        cur = conn.execute(
            f"UPDATE decks SET {assignments}, updated_at = {_NOW_SQL} WHERE id = ?",
            (*fields.values(), deck_id),
        )
    except sqlite3.Error:
        conn.rollback()
        raise
    conn.commit()
    if cur.rowcount == 0:
        return None
    return _require_deck_row(conn, deck_id)


def delete_deck(conn: sqlite3.Connection, deck_id: int) -> bool:
    """Unbind a Tome. Its slots cascade and inventory is untouched.

    Returns ``True`` if a Tome was deleted, ``False`` if none had this id.
    """
    cur = conn.execute("DELETE FROM decks WHERE id = ?", (deck_id,))
    conn.commit()
    return cur.rowcount > 0


# --- slots ------------------------------------------------------------------


def _check_singleton(
    conn: sqlite3.Connection,
    deck_id: int,
    scryfall_id: str,
    board: str,
    quantity: int,
    *,
    except_slot_id: int | None = None,
) -> None:
    """Raise :class:`SlotConflictError` if a slot would break the one-copy rule.

    Commander and companion hold one copy of a card. The lookup ignores finish,
    so a foil copy can't join a nonfoil one on the same board. Different
    printings can share the board, which is how partners work.
    ``except_slot_id`` is the slot being amended, so it never conflicts with
    itself.
    """
    if board not in SINGLETON_BOARDS:
        return
    if quantity > 1:
        raise SlotConflictError(f"A {board} slot holds exactly one copy, not {quantity}.")
    row = conn.execute(
        "SELECT id FROM deck_cards WHERE deck_id = ? AND scryfall_id = ? AND board = ? "
        "AND id IS NOT ? ORDER BY id LIMIT 1",
        (deck_id, scryfall_id, board, except_slot_id),
    ).fetchone()
    if row is not None:
        existing = int(row[0])
        raise SlotConflictError(
            f"This card is already the Tome's {board} (slot {existing}).",
            existing_slot_id=existing,
        )


def add_slot(
    conn: sqlite3.Connection,
    deck_id: int,
    *,
    scryfall_id: str,
    finish: str = "nonfoil",
    board: str = "main",
    quantity: int = 1,
) -> dict[str, Any] | None:
    """Add copies of a printing to a Tome and return the slot, or ``None`` if no Tome.

    Adding to a tuple the Tome already holds raises that slot's quantity, so
    the returned slot may be an existing one. On a singleton board (commander,
    companion) a second copy of the card, in any finish, raises
    :class:`SlotConflictError` instead.

    A claiming Tome that would take copies another claiming Tome already holds
    raises :class:`~scriptorium.reservations.ReservationConflictError`, after
    a rollback, and nothing is written.

    A printing missing from the catalog makes the foreign key raise
    :class:`sqlite3.IntegrityError`, after a rollback, and nothing is written.
    """
    if not deck_exists(conn, deck_id):
        return None
    conn.execute("BEGIN IMMEDIATE")
    try:
        _check_singleton(conn, deck_id, scryfall_id, board, quantity)
        own_before = reservations.own_demand(conn, deck_id, scryfall_id, finish)
        reservations.check_claim(
            conn,
            deck_id,
            scryfall_id,
            finish,
            board,
            own_after=own_before + quantity,
            own_before=own_before,
        )
        row = conn.execute(
            "INSERT INTO deck_cards (deck_id, scryfall_id, finish, board, quantity) "
            "VALUES (?, ?, ?, ?, ?) "
            "ON CONFLICT (deck_id, scryfall_id, finish, board) "
            "DO UPDATE SET quantity = quantity + excluded.quantity "
            "RETURNING id",
            (deck_id, scryfall_id, finish, board, quantity),
        ).fetchone()
        _touch(conn, deck_id)
    except BaseException:
        # BaseException, not a list of types: whatever escapes after BEGIN
        # IMMEDIATE (a refusal, a database error, a KeyboardInterrupt) must
        # release the write lock before it propagates.
        conn.rollback()
        raise
    conn.commit()
    return _require_slot(conn, deck_id, int(row[0]))


def update_slot(
    conn: sqlite3.Connection, deck_id: int, slot_id: int, updates: dict[str, Any]
) -> dict[str, Any] | None:
    """Amend a slot and return it, or ``None`` if the Tome has no such slot.

    Any of quantity, scryfall_id, finish, and board may change; other keys are
    ignored, and an empty ``updates`` is a no-op. Raises
    :class:`SlotConflictError` if the result would collide with another slot of
    the Tome (``existing_slot_id`` names it), or put more than one copy on a
    commander or companion board. Raises
    :class:`~scriptorium.reservations.ReservationConflictError` if a claiming
    Tome would raise its demand for a folio past what other claiming Tomes
    leave. An unknown ``scryfall_id`` raises :class:`sqlite3.IntegrityError`
    from the foreign key. Both roll back first.
    """
    fields = {col: updates[col] for col in _SLOT_UPDATABLE_COLUMNS if col in updates}
    if not fields:
        # Nothing to write, so no reason to contend for the write lock.
        return get_slot(conn, deck_id, slot_id)
    # Every read the checks depend on happens under the write lock, so a
    # concurrent PATCH can't change the slot between the read and the write.
    conn.execute("BEGIN IMMEDIATE")
    try:
        current = conn.execute(
            "SELECT scryfall_id, finish, board, quantity FROM deck_cards "
            "WHERE id = ? AND deck_id = ?",
            (slot_id, deck_id),
        ).fetchone()
        if current is None:
            conn.rollback()
            return None

        target = {**dict(current), **fields}
        folio = (target["scryfall_id"], target["finish"])
        _check_singleton(
            conn,
            deck_id,
            target["scryfall_id"],
            target["board"],
            target["quantity"],
            except_slot_id=slot_id,
        )
        existing = _slot_id_for(conn, deck_id, *folio, target["board"])
        if existing is not None and existing != slot_id:
            raise SlotConflictError(
                f"The Tome already holds this printing, finish, and board in slot {existing}.",
                existing_slot_id=existing,
            )
        # The Tome's demand on the target folio before and after. Before
        # includes this slot only if it already sits on that folio.
        own_before = reservations.own_demand(conn, deck_id, *folio)
        others = reservations.own_demand(conn, deck_id, *folio, except_slot_id=slot_id)
        reservations.check_claim(
            conn,
            deck_id,
            *folio,
            target["board"],
            own_after=others + target["quantity"],
            own_before=own_before,
        )
        assignments = ", ".join(f"{col} = ?" for col in fields)
        conn.execute(
            f"UPDATE deck_cards SET {assignments} WHERE id = ? AND deck_id = ?",
            (*fields.values(), slot_id, deck_id),
        )
        _touch(conn, deck_id)
    except BaseException:
        # BaseException, as in add_slot: anything escaping after BEGIN
        # IMMEDIATE must release the write lock first.
        conn.rollback()
        raise
    conn.commit()
    return _require_slot(conn, deck_id, slot_id)


def delete_slot(conn: sqlite3.Connection, deck_id: int, slot_id: int) -> bool:
    """Remove a slot from a Tome; ``False`` if the Tome has no such slot."""
    cur = conn.execute("DELETE FROM deck_cards WHERE id = ? AND deck_id = ?", (slot_id, deck_id))
    if cur.rowcount == 0:
        conn.rollback()
        return False
    _touch(conn, deck_id)
    conn.commit()
    return True


# --- breakdown --------------------------------------------------------------


def breakdown(conn: sqlite3.Connection, deck_id: int) -> dict[str, Any] | None:
    """Owned versus needed for every non-maybeboard slot of a Tome.

    Each line carries the slot fields, ``owned`` (copies of this folio in
    inventory), ``available`` (owned minus what other claiming Tomes reserve,
    floored at zero), ``have`` and ``needed`` (this slot's share after earlier
    boards of the same Tome are served), and the ``card`` display object. A line
    with ``needed > 0`` also carries ``swap_hint``, the card's ownership across
    every printing (:func:`scriptorium.inventory.owned_across_printings`), so
    the editor can offer a printing the user already owns. Otherwise
    ``swap_hint`` is ``None``.

    Returns ``None`` if the Tome doesn't exist.
    """
    if not deck_exists(conn, deck_id):
        return None
    rows = conn.execute(_BREAKDOWN_SQL, {"deck": deck_id}).fetchall()
    lines = []
    # One lookup per printing, even when it is short on several boards or finishes.
    hints: dict[str, dict[str, Any] | None] = {}
    for row in rows:
        line = _split_card(dict(row))
        scryfall_id = line["scryfall_id"]
        if line["needed"] > 0 and scryfall_id not in hints:
            hints[scryfall_id] = owned_across_printings(conn, scryfall_id)
        line["swap_hint"] = hints[scryfall_id] if line["needed"] > 0 else None
        lines.append(line)
    return {
        "deck_id": deck_id,
        "lines": lines,
        "totals": {
            "cards": sum(line["quantity"] for line in lines),
            "have": sum(line["have"] for line in lines),
            "needed": sum(line["needed"] for line in lines),
        },
    }
