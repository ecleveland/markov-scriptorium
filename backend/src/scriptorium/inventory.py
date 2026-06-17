"""Owned-inventory read/write layer (VEG-218, builds on ADR 0009).

CRUD over the ``inventory`` table (migration 0005): one row per acquisition lot
of an owned printing. List and detail reads join ``cards`` and attach a nested
``card`` object (name, set, collector number, image) so the Inscribe UI needn't
round-trip per row. The ``tags`` JSON-text column is (de)serialized here, at the
edge, mirroring :mod:`scriptorium.catalog`'s handling of the card JSON columns.

Write functions commit their own transaction: each call is a complete operation,
so a created/updated/deleted lot is durable when the function returns. All
functions expect a connection opened via :func:`scriptorium.db.connect` (i.e.
``row_factory = sqlite3.Row`` with foreign keys enforced).
"""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterable
from typing import Any

# Inventory columns settable on insert (id is the surrogate key; everything else
# is caller-supplied or defaulted by the schema).
_INSERT_COLUMNS = (
    "scryfall_id",
    "quantity",
    "finish",
    "condition",
    "language",
    "location",
    "acquired_at",
    "price_paid",
    "notes",
    "tags",
)

# Columns PATCH may change (VEG-218). A fixed allowlist: callers never name
# columns directly, so a bad key can't reach the SQL.
_UPDATABLE_COLUMNS = ("quantity", "condition", "location", "notes")

# Schema defaults for the NOT-NULL columns, applied when a bulk row omits them
# (an explicit NULL would violate the constraint instead of taking the default).
_LOT_DEFAULTS = {"quantity": 1, "finish": "nonfoil", "condition": "NM", "language": "en"}

# Card display fields joined onto each lot, under a nested ``card`` object.
_CARD_DISPLAY_COLUMNS = (
    "name",
    "set_code",
    "set_name",
    "collector_number",
    "rarity",
    "image_uris",
)

# The shared SELECT: every inventory column plus the card display columns aliased
# under a ``card_`` prefix, so :func:`_row_to_lot` can split them back apart.
_LOT_SELECT = (
    "SELECT i.id, i.scryfall_id, i.quantity, i.finish, i.condition, i.language, "
    "i.location, i.acquired_at, i.price_paid, i.notes, i.tags, "
    + ", ".join(f"c.{col} AS card_{col}" for col in _CARD_DISPLAY_COLUMNS)
    + " FROM inventory i JOIN cards c ON c.scryfall_id = i.scryfall_id"
)


def _row_to_lot(row: sqlite3.Row) -> dict[str, Any]:
    """Split a joined row into a lot dict with a nested ``card`` object.

    Deserializes the lot's ``tags`` JSON array and the card's ``image_uris`` JSON
    object back into structured values (leaving NULLs as ``None``).
    """
    record = dict(row)
    card: dict[str, Any] = {col: record.pop(f"card_{col}") for col in _CARD_DISPLAY_COLUMNS}
    if card.get("image_uris") is not None:
        card["image_uris"] = json.loads(card["image_uris"])
    if record.get("tags") is not None:
        record["tags"] = json.loads(record["tags"])
    record["card"] = card
    return record


def printing_exists(conn: sqlite3.Connection, scryfall_id: str) -> bool:
    """Whether a printing with this Scryfall ID resides in the catalog."""
    row = conn.execute("SELECT 1 FROM cards WHERE scryfall_id = ?", (scryfall_id,)).fetchone()
    return row is not None


# SQLite caps host parameters per statement; chunk well under it for the IN query.
_ID_QUERY_CHUNK = 500


def existing_printing_ids(conn: sqlite3.Connection, scryfall_ids: Iterable[str]) -> set[str]:
    """Return the subset of ``scryfall_ids`` that exist in the catalog.

    A single batched lookup for bulk inscribe's up-front validation, chunked to
    stay under SQLite's per-statement parameter limit on large imports.
    """
    unique = list(set(scryfall_ids))
    present: set[str] = set()
    for start in range(0, len(unique), _ID_QUERY_CHUNK):
        chunk = unique[start : start + _ID_QUERY_CHUNK]
        placeholders = ", ".join("?" for _ in chunk)
        rows = conn.execute(
            f"SELECT scryfall_id FROM cards WHERE scryfall_id IN ({placeholders})", chunk
        ).fetchall()
        present.update(row[0] for row in rows)
    return present


def create_lot(
    conn: sqlite3.Connection,
    *,
    scryfall_id: str,
    quantity: int = 1,
    finish: str = "nonfoil",
    condition: str = "NM",
    language: str = "en",
    location: str | None = None,
    acquired_at: str | None = None,
    price_paid: str | None = None,
    notes: str | None = None,
    tags: list[str] | None = None,
) -> dict[str, Any]:
    """Inscribe a new acquisition lot; return the created (enriched) record.

    The caller is responsible for confirming ``scryfall_id`` exists in the
    catalog first (see :func:`printing_exists`); otherwise the foreign key
    rejects the insert with :class:`sqlite3.IntegrityError`.
    """
    lot_id = _insert_lot(
        conn,
        {
            "scryfall_id": scryfall_id,
            "quantity": quantity,
            "finish": finish,
            "condition": condition,
            "language": language,
            "location": location,
            "acquired_at": acquired_at,
            "price_paid": price_paid,
            "notes": notes,
            "tags": tags,
        },
    )
    conn.commit()
    return _require_lot(conn, lot_id)


def create_lots(conn: sqlite3.Connection, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Insert many lots in one transaction; return the enriched lots, in order.

    All-or-nothing: if any row fails (e.g. an unknown ``scryfall_id`` the foreign
    key rejects), the whole batch is rolled back and the error re-raised, so a
    bulk import never lands a partial collection. Each ``row`` uses the same
    field names as :func:`create_lot`'s keyword arguments.
    """
    ids: list[int] = []
    try:
        for row in rows:
            ids.append(_insert_lot(conn, row))
    except sqlite3.Error:
        conn.rollback()
        raise
    conn.commit()
    return [_require_lot(conn, lot_id) for lot_id in ids]


def _insert_lot(conn: sqlite3.Connection, fields: dict[str, Any]) -> int:
    """Insert one lot row (no commit) and return its new id.

    ``fields`` carries the create_lot field names; ``tags`` (a list or ``None``)
    is serialized to JSON text here. The NOT-NULL columns fall back to the
    schema defaults when a key is missing or ``None`` (an explicit NULL would
    violate the constraint rather than take the default).
    """
    values = {col: fields.get(col) for col in _INSERT_COLUMNS}
    for col, default in _LOT_DEFAULTS.items():
        if values[col] is None:
            values[col] = default
    tags = fields.get("tags")
    values["tags"] = json.dumps(tags) if tags is not None else None
    placeholders = ", ".join("?" for _ in _INSERT_COLUMNS)
    cur = conn.execute(
        f"INSERT INTO inventory ({', '.join(_INSERT_COLUMNS)}) VALUES ({placeholders})",
        tuple(values[col] for col in _INSERT_COLUMNS),
    )
    lot_id = cur.lastrowid
    if lot_id is None:  # pragma: no cover — sqlite always reports a rowid for this insert
        raise RuntimeError("INSERT into inventory returned no row id")
    return lot_id


def _require_lot(conn: sqlite3.Connection, lot_id: int) -> dict[str, Any]:
    """Read back a lot that was just inserted; raise if it has vanished."""
    lot = get_lot(conn, lot_id)
    if lot is None:  # pragma: no cover — the row was just inserted and committed
        raise RuntimeError(f"inventory lot {lot_id} could not be read back after insert")
    return lot


def get_lot(conn: sqlite3.Connection, lot_id: int) -> dict[str, Any] | None:
    """Return one lot by id (enriched), or ``None`` if it doesn't exist."""
    row = conn.execute(f"{_LOT_SELECT} WHERE i.id = ?", (lot_id,)).fetchone()
    return _row_to_lot(row) if row is not None else None


def list_lots(
    conn: sqlite3.Connection, *, limit: int = 50, offset: int = 0
) -> tuple[list[dict[str, Any]], int]:
    """Return ``(results, total)`` for all owned lots, newest (highest id) first."""
    total = conn.execute("SELECT COUNT(*) FROM inventory").fetchone()[0]
    rows = conn.execute(
        f"{_LOT_SELECT} ORDER BY i.id DESC LIMIT ? OFFSET ?", (limit, offset)
    ).fetchall()
    return [_row_to_lot(row) for row in rows], total


def update_lot(
    conn: sqlite3.Connection, lot_id: int, updates: dict[str, Any]
) -> dict[str, Any] | None:
    """Apply ``updates`` to a lot and return it (enriched), or ``None`` if absent.

    Only the columns in :data:`_UPDATABLE_COLUMNS` are written; any other key is
    ignored. An empty (or fully-ignored) ``updates`` is a no-op that returns the
    lot unchanged.
    """
    fields = {col: updates[col] for col in _UPDATABLE_COLUMNS if col in updates}
    if not fields:
        # No-op: nothing to change. Return the lot if it exists, else None.
        return get_lot(conn, lot_id)
    assignments = ", ".join(f"{col} = ?" for col in fields)
    cur = conn.execute(
        f"UPDATE inventory SET {assignments} WHERE id = ?",
        (*fields.values(), lot_id),
    )
    conn.commit()
    if cur.rowcount == 0:  # no lot with this id
        return None
    return get_lot(conn, lot_id)


def delete_lot(conn: sqlite3.Connection, lot_id: int) -> bool:
    """Remove a lot; return ``True`` if a row was deleted, ``False`` if absent."""
    cur = conn.execute("DELETE FROM inventory WHERE id = ?", (lot_id,))
    conn.commit()
    return cur.rowcount > 0


def owned_for_printing(conn: sqlite3.Connection, scryfall_id: str) -> dict[str, Any]:
    """All owned lots of one printing, with a per-folio ``SUM(quantity)`` rollup.

    Returns the printing's ``card`` display object, every owned ``lots`` row, a
    ``rollup`` of ``(finish, condition, language)`` groups (each with summed
    ``quantity`` and lot count), and the ``total_quantity`` across all lots. A
    printing that exists in the catalog but is unowned yields empty lists and a
    zero total. The caller confirms the printing exists (see
    :func:`printing_exists`); a card object is always present for a real printing.
    """
    lot_rows = conn.execute(
        f"{_LOT_SELECT} WHERE i.scryfall_id = ? ORDER BY i.id", (scryfall_id,)
    ).fetchall()
    lots = [_row_to_lot(row) for row in lot_rows]

    rollup_rows = conn.execute(
        "SELECT finish, condition, language, SUM(quantity) AS quantity, COUNT(*) AS lots "
        "FROM inventory WHERE scryfall_id = ? "
        "GROUP BY finish, condition, language ORDER BY finish, condition, language",
        (scryfall_id,),
    ).fetchall()
    rollup = [dict(row) for row in rollup_rows]
    total_quantity = sum(row["quantity"] for row in rollup)

    # Every lot already carries the identical nested card object (inner join on
    # cards); reuse it and only query separately when the printing is unowned.
    card = lots[0]["card"] if lots else _card_display(conn, scryfall_id)
    return {
        "scryfall_id": scryfall_id,
        "card": card,
        "lots": lots,
        "rollup": rollup,
        "total_quantity": total_quantity,
    }


def _card_display(conn: sqlite3.Connection, scryfall_id: str) -> dict[str, Any] | None:
    """Return just the display fields for a printing, or ``None`` if absent."""
    columns = ", ".join(_CARD_DISPLAY_COLUMNS)
    row = conn.execute(
        f"SELECT {columns} FROM cards WHERE scryfall_id = ?", (scryfall_id,)
    ).fetchone()
    if row is None:
        return None
    card = dict(row)
    if card.get("image_uris") is not None:
        card["image_uris"] = json.loads(card["image_uris"])
    return card
