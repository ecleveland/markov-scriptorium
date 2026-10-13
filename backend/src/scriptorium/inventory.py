"""Owned-inventory read/write layer (VEG-218, builds on ADR 0009).

CRUD over the ``inventory`` table (migration 0005): one row per acquisition lot
of an owned printing. List and detail reads join ``cards`` and attach a nested
``card`` object (name, set, collector number, image) so the Inscribe UI needn't
round-trip per row. The ``tags`` JSON-text column is (de)serialized here, at the
edge, mirroring :mod:`scriptorium.catalog`'s handling of the card JSON columns.

Two rollups sit on top of the CRUD: :func:`owned_for_printing` sums one printing
by folio, and :func:`owned_across_printings` sums a whole card over every
printing of it (VEG-220).

Reads also report how many copies claiming Tomes reserve (VEG-224, ADR 0020).
Each lot carries a ``folio`` object for its (printing, finish), the per-printing
rollup carries ``reservations`` per finish, and each printing in the
cross-printing summary carries ``reserved`` and ``available``. The SQL comes
from :mod:`scriptorium.reservations`.

:func:`search_folios` backs The Index (VEG-227). It filters owned cards and
returns one row per folio, with quantity, reservation and lot details summed
over every lot of that folio.

Write functions commit their own transaction: each call is a complete operation,
so a created/updated/deleted lot is durable when the function returns. All
functions expect a connection opened via :func:`scriptorium.db.connect` (i.e.
``row_factory = sqlite3.Row`` with foreign keys enforced).
"""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from typing import Any

from scriptorium.catalog import _escape_like
from scriptorium.reservations import owned_sql, reserved_sql

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

# Upper bound on one bulk import — well above a large personal collection, low
# enough to bound a single request's work. Shared by the bulk-inscribe and
# resolve endpoints so preview and commit accept the same batch size.
MAX_BULK_ROWS = 10000

# Card display fields joined onto each lot, under a nested ``card`` object.
_CARD_DISPLAY_COLUMNS = (
    "name",
    "set_code",
    "set_name",
    "collector_number",
    "rarity",
    "image_uris",
)

# Card fields naming a printing in the cross-printing ownership breakdown.
_PRINTING_SUMMARY_COLUMNS = ("set_code", "set_name", "collector_number", "rarity")

# The shared SELECT: every inventory column plus the card display columns aliased
# under a ``card_`` prefix, so :func:`_row_to_lot` can split them back apart, plus
# the lot's folio totals (owned across every lot, reserved by claiming Tomes).
_LOT_SELECT = (
    "SELECT i.id, i.scryfall_id, i.quantity, i.finish, i.condition, i.language, "
    "i.location, i.acquired_at, i.price_paid, i.notes, i.tags, "
    + ", ".join(f"c.{col} AS card_{col}" for col in _CARD_DISPLAY_COLUMNS)
    + f", {owned_sql('i.scryfall_id', 'i.finish')} AS folio_owned"
    + f", {reserved_sql('i.scryfall_id', 'i.finish')} AS folio_reserved"
    + " FROM inventory i JOIN cards c ON c.scryfall_id = i.scryfall_id"
)

# Owned and reserved per finish of one printing, for every finish that is owned
# or claimed. A claimed but unowned finish still shows, so its shortfall does.
_RESERVATIONS_SQL = f"""
WITH finishes AS (
  SELECT finish FROM inventory WHERE scryfall_id = :sid
  UNION
  SELECT dc.finish FROM deck_cards dc JOIN decks d ON d.id = dc.deck_id
  WHERE d.claims_cards = 1 AND dc.board <> 'maybeboard' AND dc.scryfall_id = :sid)
SELECT f.finish,
       {owned_sql(":sid", "f.finish")} AS owned,
       {reserved_sql(":sid", "f.finish")} AS reserved
FROM finishes f
ORDER BY f.finish
"""


def _with_available(record: dict[str, Any], owned_key: str) -> dict[str, Any]:
    """Add ``available``: owned minus reserved, floored at zero."""
    record["available"] = max(0, record[owned_key] - record["reserved"])
    return record


def _pop_card(record: dict[str, Any]) -> dict[str, Any]:
    """Remove the ``card_``-prefixed columns from ``record``; return them as a card.

    ``image_uris`` is parsed from JSON text, and a NULL stays ``None``.
    """
    card: dict[str, Any] = {col: record.pop(f"card_{col}") for col in _CARD_DISPLAY_COLUMNS}
    if card.get("image_uris") is not None:
        card["image_uris"] = json.loads(card["image_uris"])
    return card


def _row_to_lot(row: sqlite3.Row) -> dict[str, Any]:
    """Split a joined row into a lot dict with a nested ``card`` object.

    Deserializes the lot's ``tags`` JSON array and the card's ``image_uris`` JSON
    object back into structured values (leaving NULLs as ``None``), and nests
    the folio totals as ``folio: {owned, reserved, available}``.
    """
    record = dict(row)
    card = _pop_card(record)
    if record.get("tags") is not None:
        record["tags"] = json.loads(record["tags"])
    record["card"] = card
    folio = {"owned": record.pop("folio_owned"), "reserved": record.pop("folio_reserved")}
    record["folio"] = _with_available(folio, "owned")
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

    ``reservations`` lists ``{finish, owned, reserved, available}`` for each
    finish that is owned or reserved by a claiming Tome, ordered by finish.
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
    reservations = [
        _with_available(dict(row), "owned")
        for row in conn.execute(_RESERVATIONS_SQL, {"sid": scryfall_id}).fetchall()
    ]
    return {
        "scryfall_id": scryfall_id,
        "card": card,
        "lots": lots,
        "rollup": rollup,
        "total_quantity": total_quantity,
        "reservations": reservations,
        "across_printings": owned_across_printings(conn, scryfall_id),
    }


def owned_across_printings(conn: sqlite3.Connection, scryfall_id: str) -> dict[str, Any] | None:
    """Ownership of one *card* summed over every printing of it, or ``None``.

    Answers "you own N copies across M printings" for the card that
    ``scryfall_id`` is a printing of. Returns the grouping key used, the card
    name, the summed ``total_quantity``, the ``printing_count`` (printings that
    own at least one copy), and a per-printing breakdown ordered by set. A
    printing with nothing owned is absent from the breakdown, so a wholly
    unowned card yields a zero total and an empty list. ``None`` means the
    anchor printing isn't in the catalog at all.

    Each printing also carries ``reserved``, the owned copies claiming Tomes
    reserve, and ``available`` (``quantity`` minus ``reserved``). Reserved is
    counted per finish and capped at what is owned in that finish before it is
    summed, so a claim on a foil the user doesn't own never eats a nonfoil.

    A printing's card identity is its ``oracle_id``, which is what Scryfall uses
    to tie reprints together, and its name only when there is no ``oracle_id``
    (``WHERE oracle_id = NULL`` matches nothing in SQLite, so the column alone
    cannot group the un-oracled rows). Those two groups never mix. That keeps
    identity an equivalence relation, which is what makes the total independent
    of the folio it was asked from; a rule that reached from one group into the
    other would report a different number per printing. The cost is that a card
    whose printings are inconsistently oracled counts as two, which is the
    better failure: an under-count is visible, a silent merge of two different
    cards is not.
    """
    anchor = conn.execute(
        "SELECT oracle_id, name FROM cards WHERE scryfall_id = ?", (scryfall_id,)
    ).fetchone()
    if anchor is None:
        return None

    oracle_id, name = anchor["oracle_id"], anchor["name"]
    if oracle_id is not None:
        grouping, predicate = "oracle_id", "c.oracle_id = ?"
        params: tuple[str, ...] = (oracle_id,)
    else:
        # Un-oracled rows group among themselves, never with an oracled one.
        # Reaching across would not be an equivalence and so could not answer the
        # same from every side: with A (oracle X), B (no oracle) and C (oracle Y)
        # sharing a name, A would see A+B, C would see C+B, and B all three.
        # NOCASE matches idx_cards_name's collation, so this uses the index.
        grouping = "name"
        predicate = "c.oracle_id IS NULL AND c.name = ? COLLATE NOCASE"
        params = (name,)

    # One row per owned folio first, so reserved can be capped at what is owned
    # in that finish before the printing totals are summed.
    rows = conn.execute(
        "WITH folios AS ("
        "SELECT i.scryfall_id, SUM(i.quantity) AS owned, COUNT(*) AS lots, "
        f"{reserved_sql('i.scryfall_id', 'i.finish')} AS reserved "
        "FROM inventory i JOIN cards c ON c.scryfall_id = i.scryfall_id "
        f"WHERE {predicate} "
        "GROUP BY i.scryfall_id, i.finish) "
        "SELECT f.scryfall_id, "
        + ", ".join(f"c.{col}" for col in _PRINTING_SUMMARY_COLUMNS)
        + ", SUM(f.owned) AS quantity, SUM(f.lots) AS lots, "
        "SUM(MIN(f.owned, f.reserved)) AS reserved "
        "FROM folios f JOIN cards c ON c.scryfall_id = f.scryfall_id "
        "GROUP BY f.scryfall_id "
        # collector_number is TEXT (it can hold ★, letters, and the like), so a
        # plain sort puts "10" before "2". Cast for the numeric ordering people
        # expect and keep the raw value as the tiebreaker for non-numeric ones.
        "ORDER BY c.set_code, CAST(c.collector_number AS INTEGER), c.collector_number",
        params,
    ).fetchall()
    printings = [_with_available(dict(row), "quantity") for row in rows]

    return {
        "grouping": grouping,
        "oracle_id": oracle_id,
        "name": name,
        "total_quantity": sum(printing["quantity"] for printing in printings),
        "printing_count": len(printings),
        "printings": printings,
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


# --- search (VEG-227) --------------------------------------------------------


@dataclass(frozen=True)
class SearchFilters:
    """Filters for :func:`search_folios`. An empty field means no filter.

    Values within one field are "any of" and fields combine with AND. The one
    exception is ``color_identity``, which keeps cards whose identity fits inside
    the requested colors. ``"C"`` means colorless in both color fields.
    ``tags``, ``locations`` and ``conditions`` are lot fields: a folio matches
    when any one of its lots does.
    """

    name: str | None = None
    set_codes: tuple[str, ...] = ()
    colors: tuple[str, ...] = ()
    color_identity: tuple[str, ...] = ()
    type_line: str | None = None
    tags: tuple[str, ...] = ()
    locations: tuple[str, ...] = ()
    finishes: tuple[str, ...] = ()
    conditions: tuple[str, ...] = ()


# A WHERE fragment and the values bound to its placeholders.
_Clause = tuple[str, list[Any]]

_COLORLESS = "C"

# A card is colorless when neither the card nor any of its faces has a color.
# Valki has NULL top-level colors but colored faces, so the top level alone
# would call it colorless.
_COLORLESS_SQL = (
    "(json_array_length(coalesce(c.colors, '[]')) = 0 AND NOT EXISTS ("
    "SELECT 1 FROM card_faces cf, json_each(cf.colors) "
    "WHERE cf.scryfall_id = c.scryfall_id))"
)

# Sort keys map to fixed ORDER BY expressions; callers never supply SQL. Each
# expression takes the requested direction. ``added`` is the folio's newest lot
# id, the same insertion order list_lots calls newest first. ``set`` orders
# collector numbers numerically, as owned_across_printings does.
_SORT_EXPRESSIONS: dict[str, tuple[str, ...]] = {
    "added": ("latest_id",),
    "name": ("c.name COLLATE NOCASE",),
    "set": ("c.set_code", "CAST(c.collector_number AS INTEGER)", "c.collector_number"),
    "quantity": ("quantity",),
}
_DEFAULT_ORDER = {"added": "desc", "name": "asc", "set": "asc", "quantity": "desc"}
_ORDER_KEYWORDS = {"asc": "ASC", "desc": "DESC"}

# One row per matching folio. The CTE picks folios where any lot passes the
# filters, then the outer query sums every lot of each of them, so a lot-level
# filter never shrinks a folio's quantity or reservation.
_FOLIO_SELECT = (
    "SELECT i.scryfall_id, i.finish, SUM(i.quantity) AS quantity, COUNT(*) AS lots, "
    "MAX(i.id) AS latest_id, "
    "json_group_array(DISTINCT i.condition) AS conditions, "
    "(SELECT json_group_array(DISTINCT il.location) FROM inventory il "
    "WHERE il.scryfall_id = i.scryfall_id AND il.finish = i.finish "
    "AND il.location IS NOT NULL) AS locations, "
    "(SELECT json_group_array(DISTINCT lt.value) FROM inventory it, json_each(it.tags) lt "
    "WHERE it.scryfall_id = i.scryfall_id AND it.finish = i.finish) AS tags, "
    + ", ".join(f"c.{col} AS card_{col}" for col in _CARD_DISPLAY_COLUMNS)
    + f", {reserved_sql('i.scryfall_id', 'i.finish')} AS reserved"
    + " FROM inventory i"
    " JOIN matching m ON m.scryfall_id = i.scryfall_id AND m.finish = i.finish"
    " JOIN cards c ON c.scryfall_id = i.scryfall_id"
    " GROUP BY i.scryfall_id, i.finish"
)


def _placeholders(values: tuple[str, ...], template: str = "?") -> str:
    """One placeholder per value, comma separated, for an ``IN (...)`` list."""
    return ", ".join(template for _ in values)


def _substring_clause(column: str, term: str | None) -> _Clause | None:
    """Case-insensitive substring match on ``column``; a blank term is no filter."""
    if term is None or not term.strip():
        return None
    return f"{column} LIKE ? ESCAPE '\\' COLLATE NOCASE", [f"%{_escape_like(term.strip())}%"]


def _name_clause(filters: SearchFilters) -> _Clause | None:
    return _substring_clause("c.name", filters.name)


def _type_clause(filters: SearchFilters) -> _Clause | None:
    # Scryfall's top-level type_line reads "Front // Back" on multi-faced cards,
    # so one match covers both faces.
    return _substring_clause("c.type_line", filters.type_line)


def _set_clause(filters: SearchFilters) -> _Clause | None:
    codes = filters.set_codes
    if not codes:
        return None
    return f"lower(c.set_code) IN ({_placeholders(codes, 'lower(?)')})", list(codes)


def _colors_clause(filters: SearchFilters) -> _Clause | None:
    """Any of the colors, read from the card or from any of its faces.

    Scryfall leaves top-level ``colors`` NULL on some multi-faced layouts and
    puts them on the faces instead.
    """
    if not filters.colors:
        return None
    hues = tuple(color for color in filters.colors if color != _COLORLESS)
    parts: list[str] = []
    params: list[Any] = []
    if hues:
        marks = _placeholders(hues)
        parts.append(f"EXISTS (SELECT 1 FROM json_each(c.colors) cc WHERE cc.value IN ({marks}))")
        parts.append(
            "EXISTS (SELECT 1 FROM card_faces cf, json_each(cf.colors) fc "
            f"WHERE cf.scryfall_id = c.scryfall_id AND fc.value IN ({marks}))"
        )
        params.extend(hues * 2)
    if _COLORLESS in filters.colors:
        parts.append(_COLORLESS_SQL)
    return f"({' OR '.join(parts)})", params


def _color_identity_clause(filters: SearchFilters) -> _Clause | None:
    """Cards whose identity holds no color outside the requested ones.

    A NULL identity falls back to the card's colors, and an empty array always
    fits. Identity arrays never contain ``"C"``, so binding it is harmless, and
    ``C`` alone leaves only the colorless cards.
    """
    allowed = filters.color_identity
    if not allowed:
        return None
    return (
        "NOT EXISTS (SELECT 1 FROM json_each(coalesce(c.color_identity, c.colors, '[]')) ci "
        f"WHERE ci.value NOT IN ({_placeholders(allowed)}))",
        list(allowed),
    )


def _tags_clause(filters: SearchFilters) -> _Clause | None:
    tags = filters.tags
    if not tags:
        return None
    return (
        "EXISTS (SELECT 1 FROM json_each(coalesce(i.tags, '[]')) t "
        f"WHERE t.value IN ({_placeholders(tags)}))",
        list(tags),
    )


def _locations_clause(filters: SearchFilters) -> _Clause | None:
    # Both sides lowercase in SQL, so the folding rule is the same on each.
    locations = filters.locations
    if not locations:
        return None
    return f"lower(i.location) IN ({_placeholders(locations, 'lower(?)')})", list(locations)


def _finishes_clause(filters: SearchFilters) -> _Clause | None:
    finishes = filters.finishes
    if not finishes:
        return None
    return f"i.finish IN ({_placeholders(finishes)})", list(finishes)


def _conditions_clause(filters: SearchFilters) -> _Clause | None:
    conditions = filters.conditions
    if not conditions:
        return None
    return f"i.condition IN ({_placeholders(conditions)})", list(conditions)


_CLAUSE_BUILDERS: tuple[Callable[[SearchFilters], _Clause | None], ...] = (
    _name_clause,
    _set_clause,
    _colors_clause,
    _color_identity_clause,
    _type_clause,
    _tags_clause,
    _locations_clause,
    _finishes_clause,
    _conditions_clause,
)


def _matching_cte(filters: SearchFilters) -> _Clause:
    """The ``matching`` CTE of folios with at least one lot passing every filter."""
    clauses: list[str] = []
    params: list[Any] = []
    for build in _CLAUSE_BUILDERS:
        clause = build(filters)
        if clause is not None:
            clauses.append(clause[0])
            params.extend(clause[1])
    where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
    sql = (
        "WITH matching AS (SELECT DISTINCT i.scryfall_id, i.finish "
        f"FROM inventory i JOIN cards c ON c.scryfall_id = i.scryfall_id{where})"
    )
    return sql, params


def _row_to_folio(row: sqlite3.Row) -> dict[str, Any]:
    """Turn a grouped row into a folio dict with a nested ``card`` object."""
    record = dict(row)
    del record["latest_id"]
    for key in ("conditions", "locations", "tags"):
        record[key] = sorted(json.loads(record[key]))
    record["card"] = _pop_card(record)
    return _with_available(record, "quantity")


def search_folios(
    conn: sqlite3.Connection,
    filters: SearchFilters,
    *,
    sort: str = "added",
    order: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[dict[str, Any]], int]:
    """Return ``(results, total)``: one row per owned folio that passes ``filters``.

    A folio is a (printing, finish). Each row has ``scryfall_id``, ``finish``,
    ``quantity`` and ``lots``, the sorted distinct ``conditions``, ``locations``
    (NULL left out) and ``tags`` of its lots, the nested ``card``, and
    ``reserved`` and ``available``. All of these cover every lot of the folio,
    even when a lot filter picked it through just one lot, so ``available`` never
    exceeds ``quantity``.

    ``sort`` is ``added``, ``name``, ``set`` or ``quantity``. ``order`` defaults
    to newest or largest first for ``added`` and ``quantity`` and to A to Z for
    ``name`` and ``set``. Ties fall back to (scryfall_id, finish) ascending, so
    pages are stable. ``total`` counts every match, ignoring the page.
    """
    if sort not in _SORT_EXPRESSIONS:
        raise ValueError(f"unknown sort key {sort!r}")
    direction = _ORDER_KEYWORDS.get(order or _DEFAULT_ORDER[sort])
    if direction is None:
        raise ValueError(f"unknown sort order {order!r}")
    order_by = ", ".join(f"{expr} {direction}" for expr in _SORT_EXPRESSIONS[sort])

    cte, params = _matching_cte(filters)
    total = conn.execute(f"{cte} SELECT COUNT(*) FROM matching", params).fetchone()[0]
    rows = conn.execute(
        f"{cte} {_FOLIO_SELECT} ORDER BY {order_by}, i.scryfall_id, i.finish LIMIT ? OFFSET ?",
        [*params, limit, offset],
    ).fetchall()
    return [_row_to_folio(row) for row in rows], total
