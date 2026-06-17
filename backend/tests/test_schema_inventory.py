"""Tests for the owned-inventory schema (migration 0005, VEG-217).

These assert the shape of the ``inventory`` table: an owned-printing record
keyed to a Scryfall printing, with quantity, finish, condition, language,
free-text location, optional acquisition data, and tags/notes.

Design choices the tests pin down (see ADR 0009):

* **Lot rows, not unique folio stacks.** Each row is one acquisition lot with
  its own surrogate ``id``; the same folio may appear in several rows so a
  buy keeps its own ``acquired_at`` / ``price_paid``. Total owned of a folio is
  ``SUM(quantity)`` grouped by the printing/finish/condition/language tuple.
* **Foil and non-foil are separate rows**, enforced by the ``finish`` column,
  not by spawning duplicate name records.
* **The FK to ``cards`` restricts, not cascades** — deleting a catalog card (or
  a bulk Scryfall refresh) must never silently delete owned inventory. This is
  the deliberate opposite of ``card_faces``' cascade.
* **``location`` is free text for now**; VEG-279 owns promoting Volumes to a
  managed entity, with a migration path from this text column.

The ``catalog`` fixture opens the database the way the app does (via
``db.connect()``), so foreign-key enforcement is ON.
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


# Required (NOT NULL) columns for a minimal valid `cards` row, so inventory rows
# have a real printing to reference. Mirrors test_schema_cards' helper.
_CARD_DEFAULTS = {
    "set_code": "tst",
    "set_name": "Test Set",
    "collector_number": "1",
    "rarity": "common",
    "lang": "en",
    "layout": "normal",
    "color_identity": "[]",
    "finishes": '["nonfoil","foil"]',
}


def _insert_card(
    conn: sqlite3.Connection, scryfall_id: str, name: str, **overrides: object
) -> None:
    cols = {"scryfall_id": scryfall_id, "name": name, **_CARD_DEFAULTS, **overrides}
    placeholders = ", ".join("?" for _ in cols)
    conn.execute(
        f"INSERT INTO cards ({', '.join(cols)}) VALUES ({placeholders})",
        tuple(cols.values()),
    )


def _insert_inventory(conn: sqlite3.Connection, scryfall_id: str, **overrides: object) -> int:
    """Insert an inventory row (defaults fill the rest); return its rowid."""
    cols = {"scryfall_id": scryfall_id, **overrides}
    placeholders = ", ".join("?" for _ in cols)
    cur = conn.execute(
        f"INSERT INTO inventory ({', '.join(cols)}) VALUES ({placeholders})",
        tuple(cols.values()),
    )
    assert cur.lastrowid is not None
    return cur.lastrowid


def _columns(conn: sqlite3.Connection, table: str) -> set[str]:
    return {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}


def _pk_columns(conn: sqlite3.Connection, table: str) -> list[str]:
    rows = [(row[5], row[1]) for row in conn.execute(f"PRAGMA table_info({table})") if row[5]]
    return [name for _, name in sorted(rows)]


def _index_names(conn: sqlite3.Connection) -> set[str]:
    return {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'index'")}


def test_inventory_table_has_expected_columns(catalog: sqlite3.Connection) -> None:
    with closing(catalog) as conn:
        expected = {
            "id",
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
        }
        assert expected <= _columns(conn, "inventory")


def test_inventory_primary_key_is_surrogate_id(catalog: sqlite3.Connection) -> None:
    with closing(catalog) as conn:
        assert _pk_columns(conn, "inventory") == ["id"]


def test_inventory_fk_restricts_on_delete_cascades_on_update(catalog: sqlite3.Connection) -> None:
    """The FK targets cards(scryfall_id) with the exact actions ADR 0009 specifies."""
    with closing(catalog) as conn:
        fks = list(conn.execute("PRAGMA foreign_key_list(inventory)"))
        assert fks, "inventory should declare a foreign key"
        fk = next(f for f in fks if f[2] == "cards")
        assert fk[3] == "scryfall_id"  # local column
        assert fk[4] == "scryfall_id"  # referenced column
        assert fk[5] == "CASCADE"  # on_update: a printing-id change propagates
        assert fk[6] == "RESTRICT"  # on_delete: a card with copies cannot be deleted


def test_expected_index_exists(catalog: sqlite3.Connection) -> None:
    with closing(catalog) as conn:
        assert "idx_inventory_scryfall_id" in _index_names(conn)


def test_inventory_column_defaults(catalog: sqlite3.Connection) -> None:
    """A row inserting only scryfall_id gets sensible defaults."""
    with closing(catalog) as conn:
        _insert_card(conn, "card-1", "Edgar Markov")
        rowid = _insert_inventory(conn, "card-1")
        row = conn.execute(
            "SELECT quantity, finish, condition, language FROM inventory WHERE id = ?",
            (rowid,),
        ).fetchone()
        assert tuple(row) == (1, "nonfoil", "NM", "en")


def test_inventory_requires_scryfall_id(catalog: sqlite3.Connection) -> None:
    with closing(catalog) as conn, pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO inventory (scryfall_id) VALUES (NULL)")


def test_orphan_inventory_insert_is_rejected(catalog: sqlite3.Connection) -> None:
    """A row referencing a nonexistent printing is rejected — FK enforcement is live."""
    with closing(catalog) as conn, pytest.raises(sqlite3.IntegrityError):
        _insert_inventory(conn, "no-such-card")


def test_deleting_owned_card_is_blocked(catalog: sqlite3.Connection) -> None:
    """RESTRICT (not CASCADE): a card with inventory cannot be deleted out from under it."""
    with closing(catalog) as conn:
        _insert_card(conn, "card-2", "Sol Ring")
        _insert_inventory(conn, "card-2")
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute("DELETE FROM cards WHERE scryfall_id = 'card-2'")


def test_updating_card_id_cascades_to_inventory(catalog: sqlite3.Connection) -> None:
    """ON UPDATE CASCADE: re-keying a printing carries its owned lots along."""
    with closing(catalog) as conn:
        _insert_card(conn, "old-id", "Phyrexian Tower")
        _insert_inventory(conn, "old-id", quantity=3)
        conn.execute("UPDATE cards SET scryfall_id = 'new-id' WHERE scryfall_id = 'old-id'")
        rows = conn.execute(
            "SELECT scryfall_id, quantity FROM inventory WHERE scryfall_id = 'new-id'"
        ).fetchall()
        assert [tuple(r) for r in rows] == [("new-id", 3)]


def test_quantity_must_be_positive(catalog: sqlite3.Connection) -> None:
    with closing(catalog) as conn:
        _insert_card(conn, "card-3", "Counterspell")
        with pytest.raises(sqlite3.IntegrityError):
            _insert_inventory(conn, "card-3", quantity=0)


def test_finish_is_constrained_to_known_values(catalog: sqlite3.Connection) -> None:
    with closing(catalog) as conn:
        _insert_card(conn, "card-4", "Lightning Bolt")
        with pytest.raises(sqlite3.IntegrityError):
            _insert_inventory(conn, "card-4", finish="holographic")
        # Scryfall's finishes are all accepted.
        for finish in ("nonfoil", "foil", "etched"):
            _insert_inventory(conn, "card-4", finish=finish)


def test_condition_is_constrained_to_known_grades(catalog: sqlite3.Connection) -> None:
    with closing(catalog) as conn:
        _insert_card(conn, "card-5", "Brainstorm")
        with pytest.raises(sqlite3.IntegrityError):
            _insert_inventory(conn, "card-5", condition="MINT")
        # The documented grades are all accepted.
        for grade in ("NM", "LP", "MP", "HP", "DMG"):
            _insert_inventory(conn, "card-5", condition=grade)


def test_foil_and_nonfoil_of_same_printing_coexist(catalog: sqlite3.Connection) -> None:
    """The core constraint: foil vs non-foil are tracked as separate rows."""
    with closing(catalog) as conn:
        _insert_card(conn, "card-6", "Mana Crypt")
        _insert_inventory(conn, "card-6", finish="nonfoil", quantity=2)
        _insert_inventory(conn, "card-6", finish="foil", quantity=1)
        rows = conn.execute(
            "SELECT finish, quantity FROM inventory WHERE scryfall_id = 'card-6' ORDER BY finish"
        ).fetchall()
        assert [tuple(r) for r in rows] == [("foil", 1), ("nonfoil", 2)]


def test_same_folio_allows_multiple_lots(catalog: sqlite3.Connection) -> None:
    """Lot model: the same folio can appear twice, each with its own cost basis."""
    with closing(catalog) as conn:
        _insert_card(conn, "card-7", "Rhystic Study")
        _insert_inventory(conn, "card-7", quantity=4, acquired_at="2024-01-01", price_paid="5.00")
        _insert_inventory(conn, "card-7", quantity=2, acquired_at="2026-06-01", price_paid="8.00")
        total = conn.execute(
            "SELECT SUM(quantity) FROM inventory WHERE scryfall_id = 'card-7'"
        ).fetchone()[0]
        assert total == 6
        lots = conn.execute(
            "SELECT COUNT(*) FROM inventory WHERE scryfall_id = 'card-7'"
        ).fetchone()[0]
        assert lots == 2


def test_optional_fields_default_to_null(catalog: sqlite3.Connection) -> None:
    with closing(catalog) as conn:
        _insert_card(conn, "card-8", "Demonic Tutor")
        rowid = _insert_inventory(conn, "card-8")
        row = conn.execute(
            "SELECT location, acquired_at, price_paid, notes, tags FROM inventory WHERE id = ?",
            (rowid,),
        ).fetchone()
        assert tuple(row) == (None, None, None, None, None)
