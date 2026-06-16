"""Tests for the Scryfall status / manual-refresh endpoints and startup hook (VEG-214).

These exercise the API wiring only — the refresh itself is monkeypatched out so
no test touches the network (CLAUDE.md). The status endpoint reads the
``scryfall_refresh`` row; the trigger schedules a background refresh; the
lifespan launches a startup refresh unless disabled by env.
"""

from __future__ import annotations

import sqlite3
from contextlib import closing
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from scriptorium import db, main
from scriptorium.main import app
from scriptorium.migrations import apply_migrations
from scriptorium.scryfall.refresh import REFRESH_MAX_AGE

client = TestClient(app)


@pytest.fixture
def fresh_catalog(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Point the app at a throwaway migrated catalog with no refresh row yet."""
    db_file = tmp_path / "catalog.db"
    monkeypatch.setenv("SCRIPTORIUM_DB_PATH", str(db_file))
    with closing(db.connect()) as conn:
        apply_migrations(conn)
    return db_file


def _write_refresh_row(checked_at: str, *, version: str = "2026-06-15T00:00:00+00:00") -> None:
    with closing(db.connect()) as conn:
        conn.execute(
            "INSERT INTO scryfall_refresh "
            "(id, last_checked_at, source_updated_at, imported_at, file, card_count, face_count) "
            "VALUES (1, ?, ?, ?, ?, ?, ?)",
            (checked_at, version, checked_at, "/data/scryfall/default_cards.json.gz", 42, 7),
        )
        conn.commit()


# --- GET /scryfall/status --------------------------------------------------


def test_status_empty_before_first_refresh(fresh_catalog: Path) -> None:
    resp = client.get("/scryfall/status")
    assert resp.status_code == 200
    body = resp.json()
    assert body == {
        "last_checked_at": None,
        "source_updated_at": None,
        "imported_at": None,
        "card_count": None,
        "face_count": None,
        "stale": True,
    }


def test_status_reports_recent_refresh(fresh_catalog: Path) -> None:
    checked = (datetime.now(UTC) - timedelta(hours=1)).isoformat()
    _write_refresh_row(checked)
    body = client.get("/scryfall/status").json()
    assert body["last_checked_at"] == checked
    assert body["card_count"] == 42
    assert body["face_count"] == 7
    assert body["stale"] is False


def test_status_marks_old_refresh_stale(fresh_catalog: Path) -> None:
    checked = (datetime.now(UTC) - REFRESH_MAX_AGE - timedelta(hours=1)).isoformat()
    _write_refresh_row(checked)
    body = client.get("/scryfall/status").json()
    assert body["stale"] is True


# --- POST /scryfall/refresh ------------------------------------------------


def test_manual_refresh_returns_202_and_schedules(
    fresh_catalog: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    called: list[bool] = []
    monkeypatch.setattr(main, "_run_manual_refresh", lambda: called.append(True))
    resp = client.post("/scryfall/refresh")
    assert resp.status_code == 202
    assert "scriptorium" in resp.json()["message"].lower()
    # TestClient runs the background task after sending the response.
    assert called == [True]


def test_run_manual_refresh_executes_real_orchestration(
    fresh_catalog: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The wrapper opens a real connection, refreshes, and is version-aware (not forced)."""
    from scriptorium.scryfall import refresh as refresh_mod
    from scriptorium.scryfall.bulk import BulkDataEntry
    from scriptorium.scryfall.importer import ImportResult

    version = "2026-06-15T00:00:00+00:00"
    downloads: list[BulkDataEntry | None] = []

    def fake_fetch(client: object = None) -> BulkDataEntry:
        return BulkDataEntry("default_cards", "Default Cards", "uri", version, 1, "gzip")

    def fake_download(bulk_type: str, client: object = None, entry: object = None) -> Path:
        downloads.append(entry)  # type: ignore[arg-type]
        return Path("/tmp/does-not-matter.json.gz")

    monkeypatch.setattr(refresh_mod, "fetch_bulk_entry", fake_fetch)
    monkeypatch.setattr(refresh_mod, "download_bulk", fake_download)
    monkeypatch.setattr(refresh_mod, "import_bulk_file", lambda conn, path: ImportResult(3, 1))

    main._run_manual_refresh()
    body = client.get("/scryfall/status").json()
    assert body["source_updated_at"] == version
    assert body["card_count"] == 3
    assert body["face_count"] == 1
    assert len(downloads) == 1

    # A second manual refresh at the same version must not re-download (no force).
    downloads.clear()
    main._run_manual_refresh()
    assert downloads == []


# --- startup hook (lifespan) -----------------------------------------------


def test_auto_refresh_enabled_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SCRIPTORIUM_AUTO_REFRESH", raising=False)
    assert main._auto_refresh_enabled() is True


@pytest.mark.parametrize("value", ["0", "false", "FALSE", "no", "off"])
def test_auto_refresh_disabled_by_env(value: str, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SCRIPTORIUM_AUTO_REFRESH", value)
    assert main._auto_refresh_enabled() is False


def test_lifespan_runs_startup_refresh_when_enabled(
    fresh_catalog: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    called: list[bool] = []
    monkeypatch.setenv("SCRIPTORIUM_AUTO_REFRESH", "1")
    monkeypatch.setattr(main, "_run_startup_refresh", lambda: called.append(True))
    # Entering the context triggers startup; the finally clause awaits the task,
    # so by the time the block exits the refresh has run.
    with TestClient(app):
        pass
    assert called == [True]


def test_lifespan_skips_startup_refresh_when_disabled(
    fresh_catalog: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    called: list[bool] = []
    monkeypatch.setenv("SCRIPTORIUM_AUTO_REFRESH", "0")
    monkeypatch.setattr(main, "_run_startup_refresh", lambda: called.append(True))
    with TestClient(app):
        pass
    assert called == []


def test_lifespan_startup_refresh_failure_does_not_crash(
    fresh_catalog: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A refresh that raises is swallowed; the app still serves requests."""

    def boom() -> None:
        raise RuntimeError("scryfall is down")

    monkeypatch.setenv("SCRIPTORIUM_AUTO_REFRESH", "1")
    # _run_startup_refresh swallows internally; simulate maybe_refresh blowing up
    # to prove the wrapper, not just the stub, keeps startup alive.
    monkeypatch.setattr(main, "maybe_refresh", lambda conn: boom())
    with TestClient(app) as test_client:
        assert test_client.get("/health").status_code == 200


def test_status_connection_is_closed(fresh_catalog: Path) -> None:
    """The status endpoint must not leak the catalog connection it opens."""
    # A second writer succeeding is a proxy for 'no lingering open handle'.
    client.get("/scryfall/status")
    with closing(db.connect()) as conn:
        conn.execute("INSERT INTO scryfall_refresh (id, last_checked_at) VALUES (1, ?)", ("x",))
        conn.commit()
    with closing(db.connect()) as conn:
        row: sqlite3.Row | None = conn.execute(
            "SELECT last_checked_at FROM scryfall_refresh WHERE id = 1"
        ).fetchone()
    assert row is not None and row[0] == "x"
