"""Tests for the Scryfall status / manual-refresh endpoints and startup hook (VEG-214).

These exercise the API wiring only — the refresh itself is monkeypatched out so
no test touches the network (CLAUDE.md). The status endpoint reads the
``scryfall_refresh`` row; the trigger schedules a background refresh; the
lifespan launches a startup refresh unless disabled by env.
"""

from __future__ import annotations

import logging
import sqlite3
import threading
import time
from collections.abc import Callable, Iterator
from contextlib import closing, contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from scriptorium import db, main
from scriptorium.main import app
from scriptorium.migrations import apply_migrations
from scriptorium.scryfall.refresh import (
    REFRESH_MAX_AGE,
    RefreshStatus,
    read_status,
    record_attempt,
)

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
        "last_attempt_at": None,
        "last_error": None,
        "refreshing": False,
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
    assert resp.json()["already_running"] is False
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
        return BulkDataEntry("default_cards", "Default Cards", "uri", version, 1)

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


# --- failure visibility and single flight (VEG-392) ------------------------


@contextmanager
def _refresh_held() -> Iterator[None]:
    """Hold the refresh lock as a running refresh would, and always let it go."""
    assert main._refresh_lock.acquire(blocking=False), "refresh lock already held"
    try:
        yield
    finally:
        main._refresh_lock.release()


def _status() -> RefreshStatus | None:
    with closing(db.connect()) as conn:
        return read_status(conn)


def _fail(message: str) -> Callable[[sqlite3.Connection], None]:
    def boom(conn: sqlite3.Connection) -> None:
        raise RuntimeError(message)

    return boom


def test_status_reports_the_last_attempt(fresh_catalog: Path) -> None:
    checked = (datetime.now(UTC) - timedelta(hours=1)).isoformat()
    _write_refresh_row(checked)
    attempted = datetime.now(UTC)
    with closing(db.connect()) as conn:
        record_attempt(conn, now=attempted, error="RuntimeError: scryfall is down")

    body = client.get("/scryfall/status").json()
    assert body["last_attempt_at"] == attempted.isoformat()
    assert body["last_error"] == "RuntimeError: scryfall is down"
    assert body["refreshing"] is False
    # The import fields still describe the last good catalog.
    assert body["last_checked_at"] == checked
    assert body["card_count"] == 42


def test_status_reports_refreshing_while_a_refresh_runs(fresh_catalog: Path) -> None:
    with _refresh_held():
        body = client.get("/scryfall/status").json()
    assert body["refreshing"] is True
    assert client.get("/scryfall/status").json()["refreshing"] is False


def test_status_answers_409_while_the_catalog_is_locked(
    fresh_catalog: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """An import holding the write lock blocks readers, so status says so plainly."""

    def locked(conn: sqlite3.Connection) -> None:
        raise sqlite3.OperationalError("database is locked")

    monkeypatch.setattr(main, "read_status", locked)
    resp = client.get("/scryfall/status")
    assert resp.status_code == 409
    assert resp.json()["detail"]


def test_status_lets_other_database_errors_through(
    fresh_catalog: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def broken(conn: sqlite3.Connection) -> None:
        raise sqlite3.OperationalError("no such table: scryfall_refresh")

    monkeypatch.setattr(main, "read_status", broken)
    with pytest.raises(sqlite3.OperationalError, match="no such table"):
        client.get("/scryfall/status")


def test_manual_refresh_while_one_runs_schedules_nothing(
    fresh_catalog: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    called: list[bool] = []
    monkeypatch.setattr(main, "_run_manual_refresh", lambda: called.append(True))
    with _refresh_held():
        resp = client.post("/scryfall/refresh")
    assert resp.status_code == 202
    body = resp.json()
    assert body["already_running"] is True
    assert "already" in body["message"].lower()
    assert called == []


_VERSION = "2026-06-15T00:00:00+00:00"


def _fake_scryfall(
    monkeypatch: pytest.MonkeyPatch,
    *,
    fail: str | None = None,
    fetched_at: list[datetime] | None = None,
) -> None:
    """Fake Scryfall at the refresh module's edge, so the real orchestration runs.

    With ``fail`` the bulk listing raises that message. Otherwise it serves
    ``_VERSION`` and the import writes 3 cards and 1 face.
    """
    from scriptorium.scryfall import refresh as refresh_mod
    from scriptorium.scryfall.bulk import BulkDataEntry
    from scriptorium.scryfall.importer import ImportResult

    def fake_fetch(client: object = None) -> BulkDataEntry:
        if fetched_at is not None:
            fetched_at.append(datetime.now(UTC))
        if fail is not None:
            raise RuntimeError(fail)
        return BulkDataEntry("default_cards", "Default Cards", "uri", _VERSION, 1)

    def fake_download(bulk_type: str, client: object = None, entry: object = None) -> Path:
        return Path("/tmp/does-not-matter.json.gz")

    monkeypatch.setattr(refresh_mod, "fetch_bulk_entry", fake_fetch)
    monkeypatch.setattr(refresh_mod, "download_bulk", fake_download)
    monkeypatch.setattr(refresh_mod, "import_bulk_file", lambda conn, path: ImportResult(3, 1))


def test_failed_manual_refresh_records_the_error_then_success_clears_it(
    fresh_catalog: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    fetched_at: list[datetime] = []
    _fake_scryfall(monkeypatch, fail="scryfall is down", fetched_at=fetched_at)
    main._run_manual_refresh()

    failed = _status()
    assert failed is not None
    assert failed.last_error == "RuntimeError: scryfall is down"
    assert failed.last_attempt_at is not None
    # The attempt is stamped when it starts, not when it fails.
    assert datetime.fromisoformat(failed.last_attempt_at) <= fetched_at[0]

    earlier = datetime(2026, 1, 1, tzinfo=UTC)
    with closing(db.connect()) as conn:
        record_attempt(conn, now=earlier, error=failed.last_error)
    _fake_scryfall(monkeypatch)
    main._run_manual_refresh()

    succeeded = _status()
    assert succeeded is not None
    assert succeeded.last_error is None
    assert succeeded.last_attempt_at is not None
    assert datetime.fromisoformat(succeeded.last_attempt_at) > earlier
    assert succeeded.source_updated_at == _VERSION
    assert succeeded.card_count == 3


def test_failed_startup_refresh_records_the_error_then_success_clears_it(
    fresh_catalog: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _fake_scryfall(monkeypatch, fail="no network")
    main._run_startup_refresh()

    failed = _status()
    assert failed is not None
    assert failed.last_error == "RuntimeError: no network"
    assert failed.last_attempt_at is not None
    # A failed attempt is no check, so the next start tries again.
    assert failed.last_checked_at is None

    earlier = datetime(2026, 1, 1, tzinfo=UTC)
    with closing(db.connect()) as conn:
        record_attempt(conn, now=earlier, error=failed.last_error)
    _fake_scryfall(monkeypatch)
    main._run_startup_refresh()

    succeeded = _status()
    assert succeeded is not None
    assert succeeded.last_error is None
    assert succeeded.last_attempt_at is not None
    assert datetime.fromisoformat(succeeded.last_attempt_at) > earlier
    assert succeeded.source_updated_at == _VERSION


def test_successful_refresh_clears_the_error_without_a_second_write(
    fresh_catalog: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The check or import clears last_error itself, so the two cannot disagree."""
    with closing(db.connect()) as conn:
        record_attempt(conn, now=datetime(2026, 1, 1, tzinfo=UTC), error="RuntimeError: down")
    recorded: list[object] = []
    monkeypatch.setattr(main, "record_attempt", lambda conn, **kwargs: recorded.append(kwargs))
    _fake_scryfall(monkeypatch)

    main._run_manual_refresh()

    assert recorded == []
    status = _status()
    assert status is not None
    assert status.last_error is None


def test_startup_refresh_on_a_fresh_catalog_skips_without_the_lock(
    fresh_catalog: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """A fresh catalog never takes the lock, so a manual refresh is not turned away."""
    _write_refresh_row((datetime.now(UTC) - timedelta(hours=1)).isoformat())
    calls: list[bool] = []
    monkeypatch.setattr(main, "maybe_refresh", lambda conn: calls.append(True))

    with _refresh_held(), caplog.at_level(logging.INFO, logger="scriptorium"):
        main._run_startup_refresh()

    assert calls == []
    assert "already running" not in caplog.text
    assert "fresh" in caplog.text


def test_startup_refresh_on_a_fresh_catalog_records_no_attempt(
    fresh_catalog: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _write_refresh_row((datetime.now(UTC) - timedelta(hours=1)).isoformat())
    calls: list[bool] = []
    monkeypatch.setattr(main, "maybe_refresh", lambda conn: calls.append(True))

    main._run_startup_refresh()

    assert calls == []
    assert not main._refresh_lock.locked()
    status = _status()
    assert status is not None
    assert status.last_attempt_at is None
    assert status.last_error is None


def test_startup_precheck_failure_falls_through_to_the_locked_refresh(
    fresh_catalog: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """A staleness check that cannot read the catalog leaves the refresh to decide."""

    def locked(conn: sqlite3.Connection) -> None:
        raise sqlite3.OperationalError("database is locked")

    monkeypatch.setattr(main, "read_status", locked)
    monkeypatch.setattr(main, "maybe_refresh", _fail("still locked"))

    main._run_startup_refresh()

    assert "staleness check failed" in caplog.text
    status = _status()
    assert status is not None
    assert status.last_error is not None and "still locked" in status.last_error
    assert not main._refresh_lock.locked()


def test_refresh_wrapper_survives_a_failure_to_record(
    fresh_catalog: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def cannot_record(conn: sqlite3.Connection, **kwargs: object) -> None:
        raise sqlite3.OperationalError("database is locked")

    monkeypatch.setattr(main, "refresh_catalog", _fail("scryfall is down"))
    monkeypatch.setattr(main, "record_attempt", cannot_record)
    main._run_manual_refresh()
    assert not main._refresh_lock.locked()


def test_lock_is_released_after_a_failed_refresh(
    fresh_catalog: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[bool] = []

    def boom(conn: sqlite3.Connection) -> None:
        calls.append(True)
        raise RuntimeError("scryfall is down")

    monkeypatch.setattr(main, "refresh_catalog", boom)
    main._run_manual_refresh()
    assert not main._refresh_lock.locked()
    main._run_manual_refresh()
    assert calls == [True, True]


@pytest.mark.parametrize("second", ["manual", "startup"])
def test_refresh_started_while_another_runs_is_skipped(
    second: str,
    fresh_catalog: Path,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    started = threading.Event()
    release = threading.Event()
    manual_calls: list[bool] = []
    startup_calls: list[bool] = []

    def slow_refresh(conn: sqlite3.Connection) -> None:
        manual_calls.append(True)
        started.set()
        release.wait(timeout=5)

    def counting_maybe_refresh(conn: sqlite3.Connection) -> object:
        startup_calls.append(True)
        return object()

    monkeypatch.setattr(main, "refresh_catalog", slow_refresh)
    monkeypatch.setattr(main, "maybe_refresh", counting_maybe_refresh)
    first = threading.Thread(target=main._run_manual_refresh)
    first.start()
    try:
        assert started.wait(timeout=5), "the first refresh never started"
        with caplog.at_level(logging.INFO, logger="scriptorium"):
            if second == "manual":
                main._run_manual_refresh()
            else:
                main._run_startup_refresh()
        # The skipped run neither refreshed nor recorded an attempt.
        assert manual_calls == [True]
        assert startup_calls == []
        assert _status() is None
        assert "already running" in caplog.text
    finally:
        release.set()
        first.join(timeout=5)
        # A stuck first run would hold the lock for every later test.
        stuck = first.is_alive() or main._refresh_lock.locked()
        if stuck and main._refresh_lock.locked():
            main._refresh_lock.release()
    assert not stuck


@contextmanager
def _catalog_locked(db_file: Path) -> Iterator[None]:
    """Hold an exclusive lock on the catalog from a second connection, as an import does."""
    holder = sqlite3.connect(db_file, isolation_level=None)
    try:
        holder.execute("BEGIN EXCLUSIVE")
        yield
    finally:
        holder.execute("ROLLBACK")
        holder.close()


def test_status_answers_409_at_once_when_a_running_refresh_holds_the_catalog(
    fresh_catalog: Path,
) -> None:
    """While a refresh runs, status does not wait out the busy timeout."""
    with _refresh_held(), _catalog_locked(fresh_catalog):
        started = time.monotonic()
        resp = client.get("/scryfall/status")
        elapsed = time.monotonic() - started
    assert resp.status_code == 409
    assert elapsed < 1


def test_status_answers_409_on_a_real_locked_catalog(
    fresh_catalog: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """SQLite's own "locked" error, after the busy timeout, maps to 409."""
    monkeypatch.setattr(db, "BUSY_TIMEOUT_MS", 50)
    with _catalog_locked(fresh_catalog):
        resp = client.get("/scryfall/status")
    assert resp.status_code == 409


def test_startup_refresh_survives_a_malformed_check_time(
    fresh_catalog: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A bad last_checked_at must not end the upkeep task that runs the daily backup."""
    _write_refresh_row("x")
    calls: list[bool] = []
    monkeypatch.setattr(main, "maybe_refresh", lambda conn: calls.append(True))

    main._run_startup_refresh()

    assert calls == [True]
    assert not main._refresh_lock.locked()


def test_startup_refresh_records_a_malformed_check_time_as_the_error(
    fresh_catalog: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _write_refresh_row("x")
    _fake_scryfall(monkeypatch)

    main._run_startup_refresh()

    status = _status()
    assert status is not None
    assert status.last_error is not None
    assert status.last_error.startswith("ValueError: ")


def test_failure_with_no_message_records_the_type_alone(
    fresh_catalog: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def boom(conn: sqlite3.Connection) -> None:
        raise RuntimeError()

    monkeypatch.setattr(main, "refresh_catalog", boom)
    main._run_manual_refresh()

    status = _status()
    assert status is not None
    assert status.last_error == "RuntimeError"


def test_long_failure_message_is_capped(
    fresh_catalog: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(main, "refresh_catalog", _fail("x" * 2000))
    main._run_manual_refresh()

    status = _status()
    assert status is not None
    assert status.last_error is not None
    assert len(status.last_error) == 500
    assert status.last_error.startswith("RuntimeError: ")


def test_failure_is_recorded_without_committing_the_failed_runs_writes(
    fresh_catalog: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def half_write_then_fail(conn: sqlite3.Connection) -> None:
        conn.execute("BEGIN")
        conn.execute("INSERT INTO scryfall_refresh (id, card_count) VALUES (1, 999)")
        raise RuntimeError("import died midway")

    monkeypatch.setattr(main, "refresh_catalog", half_write_then_fail)
    main._run_manual_refresh()

    status = _status()
    assert status is not None
    assert status.last_error == "RuntimeError: import died midway"
    assert status.card_count is None


def test_status_treats_a_malformed_check_time_as_stale(fresh_catalog: Path) -> None:
    """A last_checked_at that will not parse reads as stale instead of a 500."""
    _write_refresh_row("x")
    resp = client.get("/scryfall/status")
    assert resp.status_code == 200
    body = resp.json()
    assert body["last_checked_at"] == "x"
    assert body["stale"] is True
