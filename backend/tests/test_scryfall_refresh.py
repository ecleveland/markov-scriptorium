"""Tests for the Scryfall refresh orchestrator (VEG-214).

The orchestrator ties the downloader and importer together behind a staleness
gate and records the outcome in ``scryfall_refresh``. All HTTP is mocked with
``httpx.MockTransport`` (CLAUDE.md: mock Scryfall, no network); the data host
serves a tiny gzipped bulk file so a refresh runs end-to-end against a real
tmp catalog.
"""

from __future__ import annotations

import gzip
import json
import sqlite3
from collections.abc import Callable
from contextlib import closing
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
import pytest

from scriptorium import db
from scriptorium.migrations import apply_migrations
from scriptorium.scryfall import bulk
from scriptorium.scryfall.bulk import USER_AGENT, ScryfallBulkError
from scriptorium.scryfall.refresh import (
    REFRESH_MAX_AGE,
    RefreshStatus,
    is_stale,
    maybe_refresh,
    read_status,
    refresh_catalog,
)

_DOWNLOAD_URI = "https://data.scryfall.io/bulk/default-cards.json.gz"
_V1 = "2026-06-14T21:09:38.189+00:00"
_V2 = "2026-06-15T21:09:38.189+00:00"

_CARD: dict[str, Any] = {
    "id": "edgar-1",
    "oracle_id": "oracle-edgar",
    "name": "Edgar Markov",
    "set": "mm3",
    "set_name": "Modern Masters 2017",
    "collector_number": "128",
    "rarity": "mythic",
    "lang": "en",
    "layout": "normal",
}

Handler = Callable[[httpx.Request], httpx.Response]


def _gz(cards: list[dict[str, Any]]) -> bytes:
    return gzip.compress(json.dumps(cards).encode())


def _bulk_list(*, updated_at: str, size: int) -> dict[str, object]:
    return {
        "object": "list",
        "data": [
            {
                "object": "bulk_data",
                "type": "default_cards",
                "name": "Default Cards",
                "download_uri": _DOWNLOAD_URI,
                "updated_at": updated_at,
                "size": size,
                "content_encoding": "gzip",
            }
        ],
    }


def _make_handler(
    *,
    updated_at: str = _V1,
    cards: list[dict[str, Any]] | None = None,
    seen: list[httpx.Request] | None = None,
) -> Handler:
    body = _gz(cards if cards is not None else [_CARD])
    payload = _bulk_list(updated_at=updated_at, size=len(body))

    def handler(request: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(request)
        if request.url.host == "api.scryfall.com":
            return httpx.Response(200, json=payload)
        return httpx.Response(200, content=iter([body]))

    return handler


def _client(handler: Handler) -> httpx.Client:
    return httpx.Client(
        transport=httpx.MockTransport(handler),
        headers={"User-Agent": USER_AGENT},
        follow_redirects=True,
    )


@pytest.fixture(autouse=True)
def _no_throttle(monkeypatch: pytest.MonkeyPatch) -> None:
    """Skip the rate-limit sleep so end-to-end refresh tests stay fast."""
    monkeypatch.setattr(bulk, "_throttle", lambda: None)


@pytest.fixture
def catalog(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> sqlite3.Connection:
    """A fresh migrated catalog; bulk files land in a scryfall/ dir beside it."""
    monkeypatch.setenv("SCRIPTORIUM_DB_PATH", str(tmp_path / "catalog.db"))
    conn = db.connect()
    apply_migrations(conn)
    return conn


def _now() -> datetime:
    return datetime(2026, 6, 16, 12, 0, tzinfo=UTC)


# --- is_stale --------------------------------------------------------------


def test_is_stale_when_never_refreshed() -> None:
    assert is_stale(None, now=_now()) is True


def test_is_stale_when_checked_field_empty() -> None:
    status = RefreshStatus(None, None, None, None, None, None)
    assert is_stale(status, now=_now()) is True


def test_not_stale_within_window() -> None:
    checked = (_now() - timedelta(hours=1)).isoformat()
    status = RefreshStatus(checked, _V1, checked, "f", 1, 0)
    assert is_stale(status, now=_now()) is False


def test_stale_past_window() -> None:
    checked = (_now() - REFRESH_MAX_AGE - timedelta(minutes=1)).isoformat()
    status = RefreshStatus(checked, _V1, checked, "f", 1, 0)
    assert is_stale(status, now=_now()) is True


def test_stale_exactly_at_threshold() -> None:
    """At exactly the max age the catalog is considered due for a re-check."""
    checked = (_now() - REFRESH_MAX_AGE).isoformat()
    status = RefreshStatus(checked, _V1, checked, "f", 1, 0)
    assert is_stale(status, now=_now()) is True


# --- read_status -----------------------------------------------------------


def test_read_status_none_before_first_refresh(catalog: sqlite3.Connection) -> None:
    with closing(catalog) as conn:
        assert read_status(conn) is None


# --- refresh_catalog -------------------------------------------------------


def test_first_refresh_imports_and_records(catalog: sqlite3.Connection) -> None:
    with closing(catalog) as conn, _client(_make_handler()) as client:
        result = refresh_catalog(conn, client=client, now=_now())

        assert result.imported is True
        assert result.status.source_updated_at == _V1
        assert result.status.card_count == 1
        assert result.status.face_count == 0
        assert result.status.last_checked_at == _now().isoformat()
        assert result.status.imported_at == _now().isoformat()
        assert result.status.file is not None
        # The catalog actually holds the imported card.
        assert conn.execute("SELECT COUNT(*) FROM cards").fetchone()[0] == 1


def test_unchanged_version_skips_download_and_import(catalog: sqlite3.Connection) -> None:
    later = _now() + timedelta(hours=30)
    with closing(catalog) as conn:
        with _client(_make_handler()) as client:
            refresh_catalog(conn, client=client, now=_now())

        seen: list[httpx.Request] = []
        with _client(_make_handler(seen=seen)) as client:
            result = refresh_catalog(conn, client=client, now=later)

        assert result.imported is False
        # The heavy download host is never hit when the version is unchanged.
        assert not any(r.url.host == "data.scryfall.io" for r in seen)
        # The check timestamp advances; the imported version/counts are preserved.
        assert result.status.last_checked_at == later.isoformat()
        assert result.status.source_updated_at == _V1
        assert result.status.card_count == 1


def test_new_version_reimports(catalog: sqlite3.Connection) -> None:
    with closing(catalog) as conn:
        with _client(_make_handler(updated_at=_V1)) as client:
            refresh_catalog(conn, client=client, now=_now())

        two_cards = [_CARD, {**_CARD, "id": "edgar-2", "collector_number": "129"}]
        with _client(_make_handler(updated_at=_V2, cards=two_cards)) as client:
            result = refresh_catalog(conn, client=client, now=_now())

        assert result.imported is True
        assert result.status.source_updated_at == _V2
        assert result.status.card_count == 2
        assert conn.execute("SELECT COUNT(*) FROM cards").fetchone()[0] == 2


def test_force_reimports_unchanged_version(catalog: sqlite3.Connection) -> None:
    later = _now() + timedelta(hours=1)
    with closing(catalog) as conn:
        with _client(_make_handler()) as client:
            refresh_catalog(conn, client=client, now=_now())
        with _client(_make_handler()) as client:
            result = refresh_catalog(conn, client=client, now=later, force=True)

    # force bypasses the version skip and re-imports (the cached file is reused).
    assert result.imported is True
    assert result.status.imported_at == later.isoformat()


def test_failed_refresh_leaves_no_metadata(catalog: sqlite3.Connection) -> None:
    """A download failure propagates and writes no refresh row."""

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "api.scryfall.com":
            body = _gz([_CARD])
            return httpx.Response(200, json=_bulk_list(updated_at=_V1, size=len(body)))
        return httpx.Response(503)

    with closing(catalog) as conn:
        with _client(handler) as client, pytest.raises(ScryfallBulkError):
            refresh_catalog(conn, client=client, now=_now())
        assert read_status(conn) is None


# --- maybe_refresh ---------------------------------------------------------


def test_maybe_refresh_skips_when_fresh(catalog: sqlite3.Connection) -> None:
    with closing(catalog) as conn:
        with _client(_make_handler()) as client:
            refresh_catalog(conn, client=client, now=_now())

        seen: list[httpx.Request] = []
        soon = _now() + timedelta(hours=1)
        with _client(_make_handler(seen=seen)) as client:
            result = maybe_refresh(conn, client=client, now=soon)

        assert result is None
        # Fresh catalog: Scryfall is not contacted at all.
        assert seen == []


def test_maybe_refresh_runs_when_stale(catalog: sqlite3.Connection) -> None:
    with closing(catalog) as conn:
        with _client(_make_handler()) as client:
            refresh_catalog(conn, client=client, now=_now())

        later = _now() + REFRESH_MAX_AGE + timedelta(hours=1)
        seen: list[httpx.Request] = []
        with _client(_make_handler(seen=seen)) as client:
            result = maybe_refresh(conn, client=client, now=later)

        assert result is not None
        # Stale catalog: the bulk listing was fetched.
        assert any(r.url.host == "api.scryfall.com" for r in seen)


def test_maybe_refresh_runs_on_empty_catalog(catalog: sqlite3.Connection) -> None:
    with closing(catalog) as conn, _client(_make_handler()) as client:
        result = maybe_refresh(conn, client=client, now=_now())
    assert result is not None
    assert result.imported is True
