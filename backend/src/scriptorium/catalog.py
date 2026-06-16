"""Read access to the local card catalog (VEG-215, ADR 0008).

Serves card lookups from the local SQLite catalog — never live Scryfall calls
(CLAUDE.md). The JSON-text columns the importer stores verbatim (colors,
legalities, image_uris, …) are deserialized back into real JSON here, at the
edge, so callers and the API get structured data.

Name search and autocomplete use the ``cards_fts`` trigram index (migration
0004) for substring/fuzzy matching. Trigram tokens need >=3 characters, so
shorter queries fall back to a LIKE prefix/substring that rides the NOCASE name
index.

All functions here expect a connection opened via :func:`scriptorium.db.connect`
(i.e. ``row_factory = sqlite3.Row``); rows are converted with ``dict(row)``.
"""

from __future__ import annotations

import json
import sqlite3
from typing import Any

# Minimum query length the trigram index can tokenize; below this we LIKE-match.
_MIN_TRIGRAM = 3

# Cap on trigram matches scanned for autocomplete before de-duping to distinct
# names. Bounds the per-keystroke join+sort on a large catalog (a common 3-char
# substring can match tens of thousands of printings). Kept well above the max
# requested ``limit`` so the best-ranked matches still yield enough distinct
# names; only very-low-relevance names beyond the cap can be missed.
_AUTOCOMPLETE_SCAN_CAP = 500

# JSON-text columns to deserialize back into structured JSON on the way out.
_JSON_CARD_COLUMNS = ("colors", "color_identity", "finishes", "legalities", "image_uris")
_JSON_FACE_COLUMNS = ("colors", "image_uris")


def rebuild_name_index(conn: sqlite3.Connection) -> None:
    """Repopulate the ``cards_fts`` index from the current ``cards`` rows.

    Called by the bulk importer after a full-replace load; external-content FTS5
    keeps no copy of the data, so it must be told to rebuild when ``cards``
    changes wholesale.
    """
    conn.execute("INSERT INTO cards_fts(cards_fts) VALUES('rebuild')")


def _row_to_card(row: sqlite3.Row) -> dict[str, Any]:
    card = dict(row)
    _deserialize(card, _JSON_CARD_COLUMNS)
    return card


def _deserialize(record: dict[str, Any], columns: tuple[str, ...]) -> None:
    """In place, replace JSON-text values with parsed JSON (leaving NULLs)."""
    for column in columns:
        value = record.get(column)
        if value is not None:
            record[column] = json.loads(value)


def _escape_like(term: str) -> str:
    r"""Escape LIKE metacharacters so a name containing % or _ matches literally."""
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def get_card(conn: sqlite3.Connection, scryfall_id: str) -> dict[str, Any] | None:
    """Return one printing by Scryfall ID with its faces, or ``None`` if absent."""
    row = conn.execute("SELECT * FROM cards WHERE scryfall_id = ?", (scryfall_id,)).fetchone()
    if row is None:
        return None
    card = _row_to_card(row)
    face_rows = conn.execute(
        "SELECT * FROM card_faces WHERE scryfall_id = ? ORDER BY face_index",
        (scryfall_id,),
    ).fetchall()
    faces = [dict(face_row) for face_row in face_rows]
    for face in faces:
        _deserialize(face, _JSON_FACE_COLUMNS)
    card["card_faces"] = faces
    return card


def search_cards(
    conn: sqlite3.Connection, query: str, *, limit: int = 20, offset: int = 0
) -> tuple[list[dict[str, Any]], int]:
    """Search printings by name; return ``(results, total)``.

    ``results`` are full printing rows (deserialized, without faces) ranked by
    match relevance for trigram queries or by name for the LIKE fallback.
    ``total`` is the unpaginated match count. A blank query returns ``([], 0)``.
    """
    term = query.strip()
    if not term:
        return [], 0

    if len(term) >= _MIN_TRIGRAM:
        match = _fts_match(term)
        total = conn.execute(
            "SELECT COUNT(*) FROM cards_fts WHERE cards_fts MATCH ?", (match,)
        ).fetchone()[0]
        rows = conn.execute(
            "SELECT c.* FROM cards c "
            "JOIN (SELECT rowid, rank FROM cards_fts WHERE cards_fts MATCH ? "
            "      ORDER BY rank LIMIT ? OFFSET ?) m ON m.rowid = c.rowid "
            "ORDER BY m.rank",
            (match, limit, offset),
        ).fetchall()
    else:
        like = f"%{_escape_like(term)}%"
        total = conn.execute(
            "SELECT COUNT(*) FROM cards WHERE name LIKE ? ESCAPE '\\' COLLATE NOCASE",
            (like,),
        ).fetchone()[0]
        rows = conn.execute(
            "SELECT * FROM cards WHERE name LIKE ? ESCAPE '\\' COLLATE NOCASE "
            "ORDER BY name LIMIT ? OFFSET ?",
            (like, limit, offset),
        ).fetchall()

    return [_row_to_card(row) for row in rows], total


def autocomplete_names(conn: sqlite3.Connection, query: str, *, limit: int = 10) -> list[str]:
    """Return distinct card names matching ``query`` for type-ahead.

    Trigram substring match (ranked) for queries of 3+ characters; a prefix LIKE
    for shorter ones. A blank query returns ``[]``.
    """
    term = query.strip()
    if not term:
        return []

    if len(term) >= _MIN_TRIGRAM:
        # Bound the match set scanned (best-ranked first) before de-duping to
        # distinct names, so a common substring doesn't sort tens of thousands
        # of rows on every keystroke.
        rows = conn.execute(
            "SELECT c.name FROM cards c "
            "JOIN (SELECT rowid, rank FROM cards_fts WHERE cards_fts MATCH ? "
            "      ORDER BY rank LIMIT ?) m ON m.rowid = c.rowid "
            "GROUP BY c.name ORDER BY MIN(m.rank) LIMIT ?",
            (_fts_match(term), _AUTOCOMPLETE_SCAN_CAP, limit),
        ).fetchall()
    else:
        like = f"{_escape_like(term)}%"
        rows = conn.execute(
            "SELECT DISTINCT name FROM cards WHERE name LIKE ? ESCAPE '\\' COLLATE NOCASE "
            "ORDER BY name LIMIT ?",
            (like, limit),
        ).fetchall()

    return [row[0] for row in rows]


def _fts_match(term: str) -> str:
    """Quote a user term as an FTS5 string literal so its characters are literal.

    Wrapping in double quotes (and doubling any inner quote) turns the term into
    a single FTS5 string token, so punctuation in card names ("Yawgmoth's Will",
    "Borrowing 100,000 Arrows") and FTS operators can't break the MATCH query.
    """
    escaped = term.replace('"', '""')
    return f'"{escaped}"'
