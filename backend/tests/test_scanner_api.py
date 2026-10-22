"""Tests for the scanner recognition stub (VEG-230, ADR 0025).

The endpoint fixes the contract VEG-231 fills. Until then it checks the image
and answers 501, so these tests pin the checks and the stub's detail.
"""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from starlette.types import Message, Scope

from scriptorium.api.scanner import MAX_IMAGE_BYTES
from scriptorium.main import app

client = TestClient(app)

JPEG = b"\xff\xd8\xff" + b"\x00" * 16
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16
NOT_YET = "The scriptorium cannot yet read a card by sight. Type its name instead."
TOO_LARGE = (
    f"The image is larger than {MAX_IMAGE_BYTES // (1024 * 1024)} MB. "
    "Capture at a lower resolution."
)


@pytest.fixture(autouse=True)
def _throwaway_catalog(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    # The handler never opens the catalog, but no test should risk real data.
    monkeypatch.setenv("SCRIPTORIUM_DB_PATH", str(tmp_path / "test.db"))


def _recognize(body: bytes, content_type: str | None) -> tuple[int, str]:
    headers = {"Content-Type": content_type} if content_type is not None else {}
    resp = client.post("/scanner/recognize", content=body, headers=headers)
    return resp.status_code, resp.json()["detail"]


def test_jpeg_answers_not_yet_implemented() -> None:
    assert _recognize(JPEG, "image/jpeg") == (501, NOT_YET)


def test_png_answers_not_yet_implemented() -> None:
    assert _recognize(PNG, "image/png") == (501, NOT_YET)


def test_content_type_parameters_are_ignored() -> None:
    assert _recognize(JPEG, "image/jpeg; charset=binary") == (501, NOT_YET)


def test_media_type_match_ignores_case() -> None:
    assert _recognize(JPEG, "Image/JPEG") == (501, NOT_YET)


def test_text_body_is_refused_as_unsupported() -> None:
    assert _recognize(b"Edgar Markov", "text/plain") == (
        415,
        "Send the card as a JPEG or PNG image.",
    )


def test_missing_content_type_is_refused_as_unsupported() -> None:
    assert _recognize(JPEG, None) == (415, "Send the card as a JPEG or PNG image.")


def test_empty_image_is_a_bad_request() -> None:
    assert _recognize(b"", "image/jpeg") == (400, "The image was empty.")


def test_image_at_the_cap_is_accepted() -> None:
    assert _recognize(b"\x00" * MAX_IMAGE_BYTES, "image/jpeg") == (501, NOT_YET)


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
    assert (resp.status_code, resp.json()["detail"]) == (501, NOT_YET)


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
