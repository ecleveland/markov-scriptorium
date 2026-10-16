"""Tests for the schema migration runner."""

from __future__ import annotations

import os
import shutil
import sqlite3
import time
from contextlib import closing
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from scriptorium.migrations import (
    _MIGRATIONS_DIR,
    MigrationError,
    _discover,
    apply_migrations,
    pending_migrations,
)


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


def test_pending_migrations_lists_only_unapplied(tmp_path: Path) -> None:
    migrations = tmp_path / "migrations"
    migrations.mkdir()
    _write(migrations, "0001_init.sql", "CREATE TABLE a (id INTEGER);")
    _write(migrations, "0002_more.sql", "CREATE TABLE b (id INTEGER);")
    _write(migrations, "0003_most.sql", "CREATE TABLE c (id INTEGER);")
    _write(migrations, "notes.sql", "not a migration")

    with closing(sqlite3.connect(tmp_path / "t.db")) as conn:
        conn.executescript("CREATE TABLE a (id INTEGER); PRAGMA user_version = 1;")
        assert pending_migrations(conn, migrations) == [2, 3]
        apply_migrations(conn, migrations)
        assert pending_migrations(conn, migrations) == []


def _backup_names(directory: Path) -> list[str]:
    return sorted(p.name for p in directory.iterdir()) if directory.exists() else []


def _newest_version() -> int:
    return max(version for version, _ in _discover(_MIGRATIONS_DIR))


def _catalog_one_version_behind(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> int:
    """Point the app at a tmp catalog missing only the newest shipped migration.

    The catalog holds one lot, so startup sees user data and a pending
    migration. Returns the catalog's version.
    """
    db_file = tmp_path / "catalog.db"
    monkeypatch.setenv("SCRIPTORIUM_DB_PATH", str(db_file))
    monkeypatch.setenv("SCRIPTORIUM_AUTO_REFRESH", "0")
    newest = _newest_version()
    older = tmp_path / "migrations_older"
    older.mkdir()
    for version, path in _discover(_MIGRATIONS_DIR):
        if version < newest:
            shutil.copy(path, older / path.name)
    with closing(sqlite3.connect(db_file)) as conn:
        version = apply_migrations(conn, older)
        conn.execute(
            "INSERT INTO cards (scryfall_id, name, set_code, set_name, collector_number,"
            " rarity, lang, layout)"
            " VALUES ('bolt-1', 'Lightning Bolt', 'lea', 'Alpha', '1', 'common', 'en', 'normal')"
        )
        conn.execute("INSERT INTO inventory (scryfall_id) VALUES ('bolt-1')")
        conn.commit()
    assert version < newest
    return version


def test_startup_seals_premigration_backup_when_user_data_and_pending(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    older = _catalog_one_version_behind(tmp_path, monkeypatch)
    from scriptorium.main import app

    with TestClient(app):  # entering the context runs the lifespan startup
        pass

    names = _backup_names(tmp_path / "backups")
    assert len(names) == 1
    assert names[0].endswith(f"-v{older}-premigration.db")
    with closing(sqlite3.connect(tmp_path / "backups" / names[0])) as copy:
        assert copy.execute("PRAGMA user_version").fetchone()[0] == older
        assert copy.execute("SELECT count(*) FROM inventory").fetchone()[0] == 1
    with closing(sqlite3.connect(tmp_path / "catalog.db")) as conn:
        assert conn.execute("PRAGMA user_version").fetchone()[0] == _newest_version()


def test_startup_skips_premigration_backup_when_one_exists_for_the_version(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    older = _catalog_one_version_behind(tmp_path, monkeypatch)
    # A copy left by an earlier start that then failed to migrate. Only its name
    # is matched, so the content does not matter.
    existing = f"scriptorium-20260101T000000Z-v{older}-premigration.db"
    (tmp_path / "backups").mkdir()
    (tmp_path / "backups" / existing).write_bytes(b"earlier copy")
    from scriptorium.main import app

    with TestClient(app):
        pass

    assert _backup_names(tmp_path / "backups") == [existing]
    with closing(sqlite3.connect(tmp_path / "catalog.db")) as conn:
        assert conn.execute("PRAGMA user_version").fetchone()[0] == _newest_version()


def test_startup_reseals_when_premigration_copy_is_stale_and_catalog_changed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    older = _catalog_one_version_behind(tmp_path, monkeypatch)
    # A copy from an earlier attempt two days ago. The catalog has gained lots
    # since, so that copy no longer protects them.
    existing = f"scriptorium-20260101T000000Z-v{older}-premigration.db"
    (tmp_path / "backups").mkdir()
    (tmp_path / "backups" / existing).write_bytes(b"earlier copy")
    two_days_ago = time.time() - 2 * 86400
    os.utime(tmp_path / "backups" / existing, (two_days_ago, two_days_ago))
    from scriptorium.main import app

    with TestClient(app):
        pass

    names = _backup_names(tmp_path / "backups")
    assert len(names) == 2
    assert all(name.endswith(f"-v{older}-premigration.db") for name in names)
    assert existing in names


def test_startup_refuses_to_migrate_when_premigration_backup_fails(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    older = _catalog_one_version_behind(tmp_path, monkeypatch)
    # main.py imports the archive module itself, so patching its attribute here
    # replaces the function the lifespan calls.
    from scriptorium import archive
    from scriptorium.main import app

    def disk_full(reason: str) -> None:
        raise archive.BackupError("disk full")

    monkeypatch.setattr(archive, "take_backup", disk_full)

    with pytest.raises(archive.BackupError, match="disk full"), TestClient(app):
        pass

    with closing(sqlite3.connect(tmp_path / "catalog.db")) as conn:
        assert conn.execute("PRAGMA user_version").fetchone()[0] == older


def test_startup_takes_no_backup_on_fresh_db(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("SCRIPTORIUM_DB_PATH", str(tmp_path / "catalog.db"))
    monkeypatch.setenv("SCRIPTORIUM_AUTO_REFRESH", "0")
    from scriptorium.main import app

    with TestClient(app):
        pass

    assert _backup_names(tmp_path / "backups") == []
    with closing(sqlite3.connect(tmp_path / "catalog.db")) as conn:
        assert conn.execute("PRAGMA user_version").fetchone()[0] == _newest_version()
