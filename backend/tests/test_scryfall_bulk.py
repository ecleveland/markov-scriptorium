"""Tests for the Scryfall bulk-data downloader (VEG-212).

All HTTP is mocked with ``httpx.MockTransport`` — no network calls (CLAUDE.md:
mock Scryfall). The handler routes by host: the API host serves the bulk-data
list, the data host serves the (gzipped) file bytes.
"""

from __future__ import annotations

import gzip
from collections.abc import Callable
from pathlib import Path

import httpx
import pytest

from scriptorium.scryfall import bulk
from scriptorium.scryfall.bulk import (
    USER_AGENT,
    BulkDataEntry,
    ScryfallBulkError,
    download_bulk,
    fetch_bulk_entry,
)

# A tiny stand-in for the ~547MB default_cards export.
_RAW_JSON = b'[{"id":"abc-123","name":"Edgar Markov"}]'
_GZ_BYTES = gzip.compress(_RAW_JSON)
_UPDATED_AT = "2026-06-14T21:09:38.189+00:00"
_DOWNLOAD_URI = "https://data.scryfall.io/bulk/default-cards.json.gz"

Handler = Callable[[httpx.Request], httpx.Response]


def _bulk_list(
    *, bulk_type: str = "default_cards", content_encoding: str | None = "gzip"
) -> dict[str, object]:
    return {
        "object": "list",
        "has_more": False,
        "data": [
            {
                "object": "bulk_data",
                "type": bulk_type,
                "name": "Default Cards",
                "download_uri": _DOWNLOAD_URI,
                "updated_at": _UPDATED_AT,
                "size": len(_GZ_BYTES),
                "content_type": "application/json",
                "content_encoding": content_encoding,
            }
        ],
    }


def _make_handler(
    *,
    list_payload: dict[str, object] | None = None,
    list_status: int = 200,
    download_status: int = 200,
    seen: list[httpx.Request] | None = None,
) -> Handler:
    payload = list_payload if list_payload is not None else _bulk_list()

    def handler(request: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(request)
        if request.url.host == "api.scryfall.com":
            if list_status != 200:
                return httpx.Response(list_status, json={"error": "boom"})
            return httpx.Response(200, json=payload)
        # data host: stream the gzip bytes as opaque content. Passing an
        # iterator (not bytes) makes httpx treat it as a real streamable body,
        # which is what download_bulk's iter_raw() consumes.
        if download_status != 200:
            return httpx.Response(download_status)
        return httpx.Response(200, content=iter([_GZ_BYTES]))

    return handler


def _client(handler: Handler) -> httpx.Client:
    """A client wired to the mock transport but carrying the production headers."""
    return httpx.Client(
        transport=httpx.MockTransport(handler),
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        follow_redirects=True,
    )


@pytest.fixture(autouse=True)
def _no_throttle(monkeypatch: pytest.MonkeyPatch) -> list[None]:
    """Replace the real rate-limit sleep with a no-op counter (keeps tests fast)."""
    calls: list[None] = []
    monkeypatch.setattr(bulk, "_throttle", lambda: calls.append(None))
    return calls


# --- fetch_bulk_entry ------------------------------------------------------


def test_fetch_bulk_entry_returns_default_cards() -> None:
    with _client(_make_handler()) as client:
        entry = fetch_bulk_entry("default_cards", client=client)
    assert isinstance(entry, BulkDataEntry)
    assert entry.bulk_type == "default_cards"
    assert entry.download_uri == _DOWNLOAD_URI
    assert entry.updated_at == _UPDATED_AT
    assert entry.size == len(_GZ_BYTES)
    assert entry.content_encoding == "gzip"


def test_fetch_bulk_entry_unknown_type_raises() -> None:
    with (
        _client(_make_handler()) as client,
        pytest.raises(ScryfallBulkError, match="oracle_cards"),
    ):
        fetch_bulk_entry("oracle_cards", client=client)


def test_fetch_bulk_entry_http_error_raises() -> None:
    with (
        _client(_make_handler(list_status=500)) as client,
        pytest.raises(ScryfallBulkError),
    ):
        fetch_bulk_entry("default_cards", client=client)


# --- download_bulk ---------------------------------------------------------


def test_download_writes_compressed_file_named_by_updated_at(tmp_path: Path) -> None:
    with _client(_make_handler()) as client:
        path = download_bulk("default_cards", dest_dir=tmp_path, client=client)
    assert path == tmp_path / "default_cards-20260614T210938Z.json.gz"
    assert path.read_bytes() == _GZ_BYTES
    # The stored file is the gzip stream as-is; it decompresses to the JSON.
    assert gzip.decompress(path.read_bytes()) == _RAW_JSON


def test_download_leaves_no_partial_file(tmp_path: Path) -> None:
    with _client(_make_handler()) as client:
        download_bulk("default_cards", dest_dir=tmp_path, client=client)
    assert list(tmp_path.glob("*.partial")) == []


def test_download_is_idempotent_for_same_version(tmp_path: Path) -> None:
    """If the exact version is already on disk, don't re-fetch the file."""
    target = tmp_path / "default_cards-20260614T210938Z.json.gz"
    target.write_bytes(_GZ_BYTES)
    seen: list[httpx.Request] = []
    with _client(_make_handler(seen=seen)) as client:
        path = download_bulk("default_cards", dest_dir=tmp_path, client=client)
    assert path == target
    # The data host must not be hit when we already have this version.
    assert not any(r.url.host == "data.scryfall.io" for r in seen)


def test_download_failure_raises_and_cleans_up(tmp_path: Path) -> None:
    with (
        _client(_make_handler(download_status=503)) as client,
        pytest.raises(ScryfallBulkError),
    ):
        download_bulk("default_cards", dest_dir=tmp_path, client=client)
    # Neither a final file nor a partial is left behind.
    assert list(tmp_path.iterdir()) == []


def test_download_sends_user_agent_to_both_hosts(tmp_path: Path) -> None:
    seen: list[httpx.Request] = []
    with _client(_make_handler(seen=seen)) as client:
        download_bulk("default_cards", dest_dir=tmp_path, client=client)
    hosts = {r.url.host for r in seen}
    assert hosts == {"api.scryfall.com", "data.scryfall.io"}
    for request in seen:
        assert request.headers["user-agent"] == USER_AGENT


def test_download_throttles_before_requests(tmp_path: Path, _no_throttle: list[None]) -> None:
    with _client(_make_handler()) as client:
        download_bulk("default_cards", dest_dir=tmp_path, client=client)
    # One throttle before the list call, one before the download.
    assert len(_no_throttle) >= 2


# --- client configuration --------------------------------------------------


def test_new_client_sets_required_scryfall_headers() -> None:
    with bulk._new_client() as client:
        assert client.headers["User-Agent"] == USER_AGENT
        assert "Accept" in client.headers
