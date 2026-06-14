"""Tests for the schema migration runner."""

from __future__ import annotations

import sqlite3
from contextlib import closing
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from scriptorium.migrations import MigrationError, apply_migrations


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
        with pytest.raises(MigrationError):
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


def test_applies_in_numeric_not_lexical_order(tmp_path: Path) -> None:
    migrations = tmp_path / "migrations"
    migrations.mkdir()
    # Unpadded numbers: a lexical sort would run "10" before "2" and the ALTER
    # would fail because table t wouldn't exist yet.
    _write(migrations, "2_create.sql", "CREATE TABLE t (id INTEGER);")
    _write(migrations, "10_alter.sql", "ALTER TABLE t ADD COLUMN name TEXT;")

    with closing(sqlite3.connect(tmp_path / "t.db")) as conn:
        assert apply_migrations(conn, migrations) == 10
        cols = [row[1] for row in conn.execute("PRAGMA table_info(t)")]
        assert cols == ["id", "name"]


def test_ignores_non_numbered_files(tmp_path: Path) -> None:
    migrations = tmp_path / "migrations"
    migrations.mkdir()
    _write(migrations, "0001_init.sql", "CREATE TABLE a (id INTEGER);")
    _write(migrations, "notes.sql", "this is not valid sql and must be ignored")

    with closing(sqlite3.connect(tmp_path / "t.db")) as conn:
        assert apply_migrations(conn, migrations) == 1


def test_missing_directory_raises(tmp_path: Path) -> None:
    with closing(sqlite3.connect(tmp_path / "t.db")) as conn, pytest.raises(MigrationError):
        apply_migrations(conn, tmp_path / "does_not_exist")


def test_duplicate_version_raises(tmp_path: Path) -> None:
    migrations = tmp_path / "migrations"
    migrations.mkdir()
    _write(migrations, "0002_a.sql", "CREATE TABLE a (id INTEGER);")
    _write(migrations, "0002_b.sql", "CREATE TABLE b (id INTEGER);")

    with closing(sqlite3.connect(tmp_path / "t.db")) as conn, pytest.raises(MigrationError):
        apply_migrations(conn, migrations)


def test_rejects_migration_with_transaction_control(tmp_path: Path) -> None:
    migrations = tmp_path / "migrations"
    migrations.mkdir()
    # A stray COMMIT would prematurely close the runner's wrapping transaction.
    _write(migrations, "0001_bad.sql", "CREATE TABLE a (id INTEGER);\nCOMMIT;")

    with closing(sqlite3.connect(tmp_path / "t.db")) as conn:
        with pytest.raises(MigrationError):
            apply_migrations(conn, migrations)
        assert conn.execute("PRAGMA user_version").fetchone()[0] == 0


def test_partial_failure_commits_earlier_then_resumes(tmp_path: Path) -> None:
    migrations = tmp_path / "migrations"
    migrations.mkdir()
    _write(migrations, "0001_good.sql", "CREATE TABLE a (id INTEGER);")
    _write(migrations, "0002_bad.sql", "CREATE TABLE a (id INTEGER);")  # 'a' exists
    db_file = tmp_path / "t.db"

    with closing(sqlite3.connect(db_file)) as conn:
        with pytest.raises(MigrationError):
            apply_migrations(conn, migrations)
        # 0001 committed; 0002 rolled back — boundaries are per-migration.
        assert conn.execute("PRAGMA user_version").fetchone()[0] == 1

    # Fix 0002; re-running applies only the now-valid 0002.
    _write(migrations, "0002_bad.sql", "CREATE TABLE b (id INTEGER);")
    with closing(sqlite3.connect(db_file)) as conn:
        assert apply_migrations(conn, migrations) == 2
        tables = {
            row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
        }
        assert {"a", "b"} <= tables
