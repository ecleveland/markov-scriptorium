"""Tests for the schema migration runner."""

from __future__ import annotations

import sqlite3
from contextlib import closing
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from scriptorium.migrations import apply_migrations


def _write(migrations_dir: Path, name: str, sql: str) -> None:
    (migrations_dir / name).write_text(sql)


def test_apply_creates_objects_and_sets_version(tmp_path: Path) -> None:
    migrations = tmp_path / "migrations"
    migrations.mkdir()
    _write(migrations, "0001_init.sql", "CREATE TABLE widget (id INTEGER PRIMARY KEY);")
    _write(migrations, "0002_add_col.sql", "ALTER TABLE widget ADD COLUMN name TEXT;")

    with closing(sqlite3.connect(tmp_path / "t.db")) as conn:
        assert apply_migrations(conn, migrations) == 2
        assert conn.execute("PRAGMA user_version").fetchone()[0] == 2
        cols = [row[1] for row in conn.execute("PRAGMA table_info(widget)")]
        assert cols == ["id", "name"]


def test_apply_is_idempotent(tmp_path: Path) -> None:
    migrations = tmp_path / "migrations"
    migrations.mkdir()
    _write(migrations, "0001_init.sql", "CREATE TABLE widget (id INTEGER PRIMARY KEY);")
    db_file = tmp_path / "t.db"

    with closing(sqlite3.connect(db_file)) as conn:
        assert apply_migrations(conn, migrations) == 1
    # Re-running against the same DB must apply nothing and not error.
    with closing(sqlite3.connect(db_file)) as conn:
        assert apply_migrations(conn, migrations) == 1
        assert conn.execute("PRAGMA user_version").fetchone()[0] == 1


def test_apply_runs_only_pending(tmp_path: Path) -> None:
    migrations = tmp_path / "migrations"
    migrations.mkdir()
    _write(migrations, "0001_init.sql", "CREATE TABLE a (id INTEGER);")
    _write(migrations, "0002_more.sql", "CREATE TABLE b (id INTEGER);")
    db_file = tmp_path / "t.db"

    with closing(sqlite3.connect(db_file)) as conn:
        # Pretend 0001 already ran.
        conn.executescript("CREATE TABLE a (id INTEGER); PRAGMA user_version = 1;")
        assert apply_migrations(conn, migrations) == 2
        tables = {
            row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
        }
        assert "b" in tables


def test_failed_migration_rolls_back(tmp_path: Path) -> None:
    migrations = tmp_path / "migrations"
    migrations.mkdir()
    # Second statement is invalid; the whole migration must roll back atomically.
    _write(
        migrations,
        "0001_bad.sql",
        "CREATE TABLE good (id INTEGER);\nCREATE TABLE good (id INTEGER);",
    )
    with closing(sqlite3.connect(tmp_path / "t.db")) as conn:
        with pytest.raises(sqlite3.OperationalError):
            apply_migrations(conn, migrations)
        # Nothing committed: version untouched and the table absent.
        assert conn.execute("PRAGMA user_version").fetchone()[0] == 0
        tables = {
            row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
        }
        assert "good" not in tables


def test_bundled_migrations_apply_cleanly(tmp_path: Path) -> None:
    """The real migrations shipped in the package apply on a fresh catalog."""
    with closing(sqlite3.connect(tmp_path / "catalog.db")) as conn:
        assert apply_migrations(conn) >= 1


def test_migrations_run_on_app_startup(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SCRIPTORIUM_DB_PATH", str(tmp_path / "catalog.db"))
    from scriptorium.main import app

    with TestClient(app):  # entering the context runs the lifespan startup
        pass

    with closing(sqlite3.connect(tmp_path / "catalog.db")) as conn:
        assert conn.execute("PRAGMA user_version").fetchone()[0] >= 1
