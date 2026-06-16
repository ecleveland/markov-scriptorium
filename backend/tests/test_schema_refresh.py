"""Tests for the Scryfall refresh metadata schema (migration 0003, VEG-214).

The auto-refresh mechanism records when the local catalog was last brought up
to date in a single-row ``scryfall_refresh`` table. These assert the shape the
bundled migrations build on a fresh catalog and the single-row invariant.
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


def _columns(conn: sqlite3.Connection, table: str) -> set[str]:
    return {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}


def _pk_columns(conn: sqlite3.Connection, table: str) -> list[str]:
    rows = [(row[5], row[1]) for row in conn.execute(f"PRAGMA table_info({table})") if row[5]]
    return [name for _, name in sorted(rows)]


def test_refresh_table_has_expected_columns(catalog: sqlite3.Connection) -> None:
    with closing(catalog) as conn:
        expected = {
            "id",
            "last_checked_at",
            "source_updated_at",
            "imported_at",
            "file",
            "card_count",
            "face_count",
        }
        assert expected <= _columns(conn, "scryfall_refresh")


def test_refresh_primary_key_is_id(catalog: sqlite3.Connection) -> None:
    with closing(catalog) as conn:
        assert _pk_columns(conn, "scryfall_refresh") == ["id"]


def test_refresh_is_single_row(catalog: sqlite3.Connection) -> None:
    """The CHECK (id = 1) constraint keeps the table to one metadata row."""
    with closing(catalog) as conn:
        conn.execute("INSERT INTO scryfall_refresh (id) VALUES (1)")
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute("INSERT INTO scryfall_refresh (id) VALUES (2)")


def test_refresh_starts_empty(catalog: sqlite3.Connection) -> None:
    """A fresh catalog has no refresh row until the first refresh runs."""
    with closing(catalog) as conn:
        count = conn.execute("SELECT COUNT(*) FROM scryfall_refresh").fetchone()[0]
        assert count == 0
