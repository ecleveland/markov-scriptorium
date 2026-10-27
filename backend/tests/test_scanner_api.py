"""Tests for the scanner recognition endpoint (VEG-230, VEG-231, ADR 0025, ADR 0026).

The checks on the image run before any recognition, in the order ADR 0025
fixes. Recognition runs through a FakeOcr installed over the get_ocr
dependency and a small seeded catalog, so no test touches a real engine.
"""

from __future__ import annotations

import asyncio
import sqlite3
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from starlette.types import Message, Scope

from scriptorium.api.scanner import MAX_IMAGE_BYTES, get_ocr
from scriptorium.main import app
from scriptorium.scanner.engines import select_engine
from scriptorium.scanner.names import invalidate
from scriptorium.scanner.ocr import OcrUnavailable, UnreadableImage
from tests.scanner.fakes import FakeOcr, line, seed_catalog

client = TestClient(app)

JPEG = b"\xff\xd8\xff" + b"\x00" * 16
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16
TOO_LARGE = (
    f"The image is larger than {MAX_IMAGE_BYTES // (1024 * 1024)} MB. "
    "Capture at a lower resolution."
)
NO_ENGINE = "No scrying glass is fitted to this scriptorium. Type the name instead."
UNREADABLE = "The glass could not make sense of that image. Capture the card again."
ENGINE_FAILED = (
    "The glass clouded over while reading. Try the capture again, or type the name instead."
)
EDGAR_READ = {"readings": [{"name": "Edgar Markov", "confidence": 1.0}]}


@pytest.fixture(autouse=True)
def _throwaway_catalog(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setenv("SCRIPTORIUM_DB_PATH", str(tmp_path / "test.db"))
    seed_catalog(("edgar", "Edgar Markov"), ("bolt", "Lightning Bolt"))
    invalidate()
    yield
    invalidate()


@pytest.fixture(autouse=True)
def engine() -> Iterator[FakeOcr]:
    fake = FakeOcr([line("Edgar Markov", 0.1)])
    _fit(fake)
    yield fake
    app.dependency_overrides.pop(get_ocr, None)


def _fit(engine: FakeOcr | None) -> None:
    app.dependency_overrides[get_ocr] = lambda: engine


def _post(body: bytes, content_type: str | None) -> tuple[int, Any]:
    headers = {"Content-Type": content_type} if content_type is not None else {}
    resp = client.post("/scanner/recognize", content=body, headers=headers)
    return resp.status_code, resp.json()


def _recognize(body: bytes, content_type: str | None) -> tuple[int, str]:
    status, payload = _post(body, content_type)
    return status, payload["detail"]


def test_jpeg_is_read_to_a_card_name(engine: FakeOcr) -> None:
    assert _post(JPEG, "image/jpeg") == (200, EDGAR_READ)
    assert engine.images[0] == JPEG


def test_png_is_read_to_a_card_name() -> None:
    assert _post(PNG, "image/png") == (200, EDGAR_READ)


def test_content_type_parameters_are_ignored() -> None:
    assert _post(JPEG, "image/jpeg; charset=binary") == (200, EDGAR_READ)


def test_media_type_match_ignores_case() -> None:
    assert _post(JPEG, "Image/JPEG") == (200, EDGAR_READ)


def test_a_still_with_no_name_reads_as_no_readings() -> None:
    noise = [line("zzqqxj wpvk", 0.1)]
    _fit(FakeOcr(noise, upside_down=noise, full_frame=noise))
    assert _post(JPEG, "image/jpeg") == (200, {"readings": []})


def test_no_engine_answers_unavailable() -> None:
    _fit(None)
    assert _recognize(JPEG, "image/jpeg") == (503, NO_ENGINE)


def test_the_type_is_checked_before_the_engine() -> None:
    _fit(None)
    assert _recognize(b"Edgar Markov", "text/plain") == (
        415,
        "Send the card as a JPEG or PNG image.",
    )


def test_an_image_the_engine_cannot_decode_is_a_bad_request() -> None:
    _fit(FakeOcr([], raise_=UnreadableImage("Error Domain=com.apple.Vision Code=13")))
    assert _recognize(JPEG, "image/jpeg") == (400, UNREADABLE)


def test_an_engine_failure_answers_unavailable() -> None:
    _fit(FakeOcr([], raise_=OcrUnavailable("Vision failed")))
    assert _recognize(JPEG, "image/jpeg") == (503, ENGINE_FAILED)


def test_a_locked_catalog_answers_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    # The nightly refresh can hold the write lock while a scan comes in.
    def locked() -> None:
        raise sqlite3.OperationalError("database is locked")

    monkeypatch.setattr("scriptorium.api.scanner.name_index", locked)
    assert _recognize(JPEG, "image/jpeg") == (503, ENGINE_FAILED)


def test_a_misconfigured_engine_falls_back_to_none(monkeypatch: pytest.MonkeyPatch) -> None:
    # get_ocr runs before the handler's checks, so it must never raise.
    monkeypatch.setenv("SCRIPTORIUM_OCR", "tesseract")
    select_engine.cache_clear()
    try:
        assert get_ocr() is None
    finally:
        select_engine.cache_clear()


@pytest.fixture
def fresh_selection(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setenv("SCRIPTORIUM_AUTO_REFRESH", "0")
    select_engine.cache_clear()
    yield
    select_engine.cache_clear()


@pytest.mark.usefixtures("fresh_selection")
def test_a_misconfigured_engine_stops_startup(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SCRIPTORIUM_OCR", "bogus")
    with pytest.raises(OcrUnavailable, match="bogus"), TestClient(app):
        pass


@pytest.mark.usefixtures("fresh_selection")
def test_startup_with_recognition_off_serves(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SCRIPTORIUM_OCR", "none")
    with TestClient(app) as started:
        assert started.get("/").status_code == 200
    assert select_engine() is None


def test_text_body_is_refused_as_unsupported() -> None:
    assert _recognize(b"Edgar Markov", "text/plain") == (
        415,
        "Send the card as a JPEG or PNG image.",
    )


def test_missing_content_type_is_refused_as_unsupported() -> None:
    assert _recognize(JPEG, None) == (415, "Send the card as a JPEG or PNG image.")


def test_empty_image_is_a_bad_request(engine: FakeOcr) -> None:
    assert _recognize(b"", "image/jpeg") == (400, "The image was empty.")
    assert engine.calls == []


def test_image_at_the_cap_is_accepted(engine: FakeOcr) -> None:
    assert _post(b"\x00" * MAX_IMAGE_BYTES, "image/jpeg") == (200, EDGAR_READ)
    assert len(engine.images[0]) == MAX_IMAGE_BYTES


def test_image_over_the_cap_is_too_large() -> None:
    assert _recognize(b"\x00" * (MAX_IMAGE_BYTES + 1), "image/jpeg") == (413, TOO_LARGE)


def test_too_large_detail_names_the_cap_the_page_quotes() -> None:
    # The frontend carries the same sentence, so the derived text must not drift.
    assert TOO_LARGE == "The image is larger than 12 MB. Capture at a lower resolution."


def test_declared_length_over_the_cap_is_refused_before_reading() -> None:
    # The small body proves the 413 comes from the header alone.
    resp = client.post(
        "/scanner/recognize",
        content=JPEG,
        headers={"Content-Type": "image/jpeg", "Content-Length": str(MAX_IMAGE_BYTES + 1)},
    )
    assert (resp.status_code, resp.json()["detail"]) == (413, TOO_LARGE)


def test_unreadable_declared_length_falls_back_to_counting() -> None:
    resp = client.post(
        "/scanner/recognize",
        content=JPEG,
        headers={"Content-Type": "image/jpeg", "Content-Length": "many"},
    )
    assert (resp.status_code, resp.json()) == (200, EDGAR_READ)


def test_streamed_body_stops_reading_once_past_the_cap() -> None:
    # TestClient always sends the whole body, so drive the app over raw ASGI
    # with no Content-Length and count how many chunks the handler pulls.
    chunk = b"\x00" * (1024 * 1024)
    total_chunks = MAX_IMAGE_BYTES // len(chunk) + 8
    pulled = 0
    sent: list[Message] = []

    async def receive() -> Message:
        nonlocal pulled
        pulled += 1
        return {"type": "http.request", "body": chunk, "more_body": pulled < total_chunks}

    async def send(message: Message) -> None:
        sent.append(message)

    scope: Scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": "/scanner/recognize",
        "raw_path": b"/scanner/recognize",
        "root_path": "",
        "query_string": b"",
        "headers": [(b"content-type", b"image/jpeg"), (b"host", b"testserver")],
        "client": ("testclient", 50000),
        "server": ("testserver", 80),
    }
    asyncio.run(app(scope, receive, send))

    start = next(m for m in sent if m["type"] == "http.response.start")
    assert start["status"] == 413
    # The chunk that crosses the cap is the last one read.
    assert pulled == MAX_IMAGE_BYTES // len(chunk) + 1
