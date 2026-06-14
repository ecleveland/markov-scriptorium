"""Tests for the Scryfall card schema (migration 0002, VEG-211).

These assert the shape the bundled migrations build on a fresh catalog: the
``cards`` printings table, the ``card_faces`` child table, the supporting
indexes, and the foreign-key wiring between them. Column checks are written as
subset assertions so a later additive migration doesn't break them.

The ``catalog`` fixture opens the database the way the app does (via
``db.connect()``), so foreign-key enforcement is ON — the tests exercise the
real connection configuration rather than SQLite's FK-off default.
"""

from __future__ import annotations

import sqlite3
from contextlib import closing
from pathlib import Path

import pytest

from scriptorium import db
from scriptorium.migrations import apply_migrations


@pytest.fixture
def catalog(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> sqlite3.Connection:
    """A fresh catalog opened via ``db.connect()`` (FK enforcement on)."""
    monkeypatch.setenv("SCRIPTORIUM_DB_PATH", str(tmp_path / "catalog.db"))
    conn = db.connect()
    apply_migrations(conn)
    return conn


# Required (NOT NULL) columns for a minimal valid `cards` row. Tests override
# individual values; everything else uses these placeholders.
_CARD_DEFAULTS = {
    "set_code": "tst",
    "set_name": "Test Set",
    "collector_number": "1",
    "rarity": "common",
    "lang": "en",
    "layout": "normal",
    "color_identity": "[]",
    "finishes": '["nonfoil"]',
}


def _insert_card(
    conn: sqlite3.Connection, scryfall_id: str, name: str, **overrides: object
) -> None:
    """Insert a `cards` row, filling required columns with placeholder defaults."""
    cols = {"scryfall_id": scryfall_id, "name": name, **_CARD_DEFAULTS, **overrides}
    placeholders = ", ".join("?" for _ in cols)
    conn.execute(
        f"INSERT INTO cards ({', '.join(cols)}) VALUES ({placeholders})",
        tuple(cols.values()),
    )


def _columns(conn: sqlite3.Connection, table: str) -> set[str]:
    return {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}


def _pk_columns(conn: sqlite3.Connection, table: str) -> list[str]:
    """Primary-key column names in key order (pk position is column index 5)."""
    rows = [(row[5], row[1]) for row in conn.execute(f"PRAGMA table_info({table})") if row[5]]
    return [name for _, name in sorted(rows)]


def _index_names(conn: sqlite3.Connection) -> set[str]:
    return {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'index'")}


def test_cards_table_has_expected_columns(catalog: sqlite3.Connection) -> None:
    with closing(catalog) as conn:
        expected = {
            "scryfall_id",
            "oracle_id",
            "name",
            "set_code",
            "set_name",
            "collector_number",
            "rarity",
            "lang",
            "released_at",
            "layout",
            "mana_cost",
            "cmc",
            "type_line",
            "oracle_text",
            "colors",
            "color_identity",
            "finishes",
            "legalities",
            "image_uris",
            "price_usd",
            "price_usd_foil",
            "price_usd_etched",
            "price_eur",
            "price_eur_foil",
            "price_tix",
            "scryfall_uri",
        }
        assert expected <= _columns(conn, "cards")


def test_cards_primary_key_is_scryfall_id(catalog: sqlite3.Connection) -> None:
    with closing(catalog) as conn:
        assert _pk_columns(conn, "cards") == ["scryfall_id"]


def test_card_faces_table_has_expected_columns(catalog: sqlite3.Connection) -> None:
    with closing(catalog) as conn:
        expected = {
            "scryfall_id",
            "face_index",
            "name",
            "mana_cost",
            "type_line",
            "oracle_text",
            "colors",
            "image_uris",
        }
        assert expected <= _columns(conn, "card_faces")


def test_card_faces_composite_primary_key(catalog: sqlite3.Connection) -> None:
    with closing(catalog) as conn:
        assert _pk_columns(conn, "card_faces") == ["scryfall_id", "face_index"]


def test_card_faces_references_cards_with_cascade(catalog: sqlite3.Connection) -> None:
    with closing(catalog) as conn:
        fks = list(conn.execute("PRAGMA foreign_key_list(card_faces)"))
        assert fks, "card_faces should declare a foreign key"
        fk = fks[0]
        assert fk[2] == "cards"  # referenced table
        assert fk[3] == "scryfall_id"  # local column
        assert fk[6] == "CASCADE"  # on delete


def test_expected_indexes_exist(catalog: sqlite3.Connection) -> None:
    with closing(catalog) as conn:
        names = _index_names(conn)
        for expected in (
            "idx_cards_name",
            "idx_cards_oracle_id",
            "idx_cards_set_code",
            "idx_cards_set_collector",
            "idx_card_faces_name",
        ):
            assert expected in names


def test_name_search_is_case_insensitive(catalog: sqlite3.Connection) -> None:
    """The NOCASE index on name backs case-insensitive local autocomplete."""
    with closing(catalog) as conn:
        _insert_card(conn, "id-1", "Edgar Markov", color_identity='["B","R","W"]')
        rows = conn.execute(
            "SELECT name FROM cards WHERE name = 'edgar markov' COLLATE NOCASE"
        ).fetchall()
        assert [r[0] for r in rows] == ["Edgar Markov"]


def test_cascade_delete_removes_faces(catalog: sqlite3.Connection) -> None:
    """Deleting a card removes its faces (FK enforcement comes from the fixture)."""
    with closing(catalog) as conn:
        _insert_card(conn, "dfc-1", "Front // Back", layout="transform")
        conn.executemany(
            "INSERT INTO card_faces (scryfall_id, face_index, name, colors) VALUES (?, ?, ?, ?)",
            [("dfc-1", 0, "Front", "[]"), ("dfc-1", 1, "Back", "[]")],
        )
        conn.execute("DELETE FROM cards WHERE scryfall_id = 'dfc-1'")
        remaining = conn.execute("SELECT COUNT(*) FROM card_faces").fetchone()[0]
        assert remaining == 0


def test_orphan_face_insert_is_rejected(catalog: sqlite3.Connection) -> None:
    """A face referencing a nonexistent card is rejected — FK enforcement is live."""
    with closing(catalog) as conn, pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO card_faces (scryfall_id, face_index, name) VALUES (?, ?, ?)",
            ("no-such-card", 0, "Orphan"),
        )


def test_cards_rejects_null_required_column(catalog: sqlite3.Connection) -> None:
    """A NOT NULL column on cards (e.g. set_code) rejects NULL."""
    with closing(catalog) as conn, pytest.raises(sqlite3.IntegrityError):
        _insert_card(conn, "id-null", "No Set", set_code=None)


def test_card_faces_rejects_null_name(catalog: sqlite3.Connection) -> None:
    """A NOT NULL column on card_faces (name) rejects NULL."""
    with closing(catalog) as conn:
        _insert_card(conn, "parent-1", "Parent")
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO card_faces (scryfall_id, face_index, name) VALUES (?, ?, ?)",
                ("parent-1", 0, None),
            )


def test_connect_enables_foreign_keys(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """db.connect() turns on FK enforcement so cascades/integrity hold."""
    monkeypatch.setenv("SCRIPTORIUM_DB_PATH", str(tmp_path / "catalog.db"))
    with closing(db.connect()) as conn:
        assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1
