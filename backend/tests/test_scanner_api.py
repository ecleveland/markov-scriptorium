"""Tests for the scanner recognition endpoint (VEG-230, VEG-231, VEG-653, ADR 0025 to 0027).

The checks on the image run before any recognition, in the order ADR 0025
fixes. Recognition runs through a FakeOcr installed over the get_ocr
dependency and a small seeded catalog, so no test touches a real engine.
"""

from __future__ import annotations

import asyncio
import sqlite3
import sys
from collections.abc import Iterator
from contextlib import closing
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from starlette.types import Message, Scope

from scriptorium import db
from scriptorium.api.scanner import MAX_IMAGE_BYTES, get_ocr
from scriptorium.main import app
from scriptorium.scanner.engines import select_engine
from scriptorium.scanner.names import invalidate
from scriptorium.scanner.ocr import OcrUnavailable, TextLine, UnreadableImage
from tests.scanner.fakes import FakeOcr, corner_line, insert_card, line, seed_catalog

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
EDGAR_READ = {"readings": [{"name": "Edgar Markov", "confidence": 1.0, "printing": None}]}
# The bottom-left corner of a Fragments common, as Vision reads it at 1080p.
FRA_2 = [corner_line("C 0002", 0.93), corner_line("FRA • EN", 0.95)]


@pytest.fixture(autouse=True)
def _throwaway_catalog(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setenv("SCRIPTORIUM_DB_PATH", str(tmp_path / "test.db"))
    seed_catalog(
        ("edgar", "Edgar Markov"),
        ("bolt", "Lightning Bolt"),
        (
            "ascent",
            "Academic Ascent",
            {"set_code": "fra", "collector_number": "2", "set_name": "Fragments"},
        ),
    )
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
    assert type(engine.images[0]) is bytes


def test_png_is_read_to_a_card_name() -> None:
    assert _post(PNG, "image/png") == (200, EDGAR_READ)


def test_content_type_parameters_are_ignored() -> None:
    assert _post(JPEG, "image/jpeg; charset=binary") == (200, EDGAR_READ)


def test_media_type_match_ignores_case() -> None:
    assert _post(JPEG, "Image/JPEG") == (200, EDGAR_READ)


def test_the_card_read_in_full_comes_before_one_found_by_trimming() -> None:
    with closing(db.connect()) as conn:
        insert_card(conn, "nicol", "Nicol Bolas")
        insert_card(conn, "ravager", "Nicol Bolas, the Ravager")
        conn.commit()
    _fit(FakeOcr([line("Nicol Bolas, the Ravager", 0.1)]))
    assert _post(JPEG, "image/jpeg") == (
        200,
        {
            "readings": [
                {"name": "Nicol Bolas, the Ravager", "confidence": 1.0, "printing": None},
                {"name": "Nicol Bolas", "confidence": 1.0, "printing": None},
            ]
        },
    )


def test_a_still_with_no_name_reads_as_no_readings() -> None:
    noise = [line("zzqqxj wpvk", 0.1)]
    _fit(FakeOcr(noise, upside_down=noise, full_frame=noise))
    assert _post(JPEG, "image/jpeg") == (200, {"readings": []})


# --- the corner (VEG-653) ---------------------------------------------------


def _readings_for(title: str, corner: list[TextLine]) -> list[dict[str, Any]]:
    _fit(FakeOcr([line(title, 0.1)], corner=corner))
    status, payload = _post(JPEG, "image/jpeg")
    assert status == 200
    readings: list[dict[str, Any]] = payload["readings"]
    return readings


def test_the_corner_pins_the_printing_of_the_name_read() -> None:
    with closing(db.connect()) as conn:
        # A near name gives a second reading, which must stay unpinned.
        insert_card(conn, "descent", "Academic Descent")
        conn.commit()
    readings = _readings_for("Academic Ascent", FRA_2)
    assert [r["name"] for r in readings[:2]] == ["Academic Ascent", "Academic Descent"]
    printing = readings[0]["printing"]
    assert printing["scryfall_id"] == "ascent"
    assert printing["set_code"] == "fra"
    assert printing["collector_number"] == "2"
    assert printing["set_name"] == "Fragments"
    assert "card_faces" not in printing
    assert all(r["printing"] is None for r in readings[1:])


def test_a_corner_pointing_at_another_card_pins_nothing() -> None:
    # Sol Ring and Savage Twister share cmd 222 in the real catalog. A misread
    # corner must never turn the name read into a different card.
    with closing(db.connect()) as conn:
        insert_card(conn, "twister", "Savage Twister", set_code="cmd", collector_number="222")
        insert_card(conn, "ring", "Sol Ring", set_code="c21", collector_number="263")
        conn.commit()
    corner = [corner_line("U 0222", 0.93), corner_line("CMD • EN", 0.95)]
    readings = _readings_for("Sol Ring", corner)
    assert readings[0]["name"] == "Sol Ring"
    assert all(r["printing"] is None for r in readings)


def test_a_pair_holding_the_name_twice_pins_nothing() -> None:
    with closing(db.connect()) as conn:
        insert_card(conn, "bolt-a", "Lightning Bolt", set_code="2x2", collector_number="117")
        insert_card(conn, "bolt-b", "Lightning Bolt", set_code="2x2", collector_number="117")
        conn.commit()
    corner = [corner_line("U 0117", 0.93), corner_line("2X2 • EN", 0.95)]
    readings = _readings_for("Lightning Bolt", corner)
    assert readings[0]["name"] == "Lightning Bolt"
    assert all(r["printing"] is None for r in readings)


def test_an_english_printing_wins_over_another_language_at_the_pair() -> None:
    with closing(db.connect()) as conn:
        insert_card(
            conn, "bolt-ja", "Lightning Bolt", set_code="sta", collector_number="42", lang="ja"
        )
        insert_card(conn, "bolt-en", "Lightning Bolt", set_code="sta", collector_number="42")
        conn.commit()
    corner = [corner_line("U 0042", 0.93), corner_line("STA • EN", 0.95)]
    readings = _readings_for("Lightning Bolt", corner)
    assert readings[0]["printing"]["scryfall_id"] == "bolt-en"


def test_a_corner_missing_from_the_catalog_pins_nothing() -> None:
    corner = [corner_line("C 0099", 0.93), corner_line("FRA • EN", 0.95)]
    readings = _readings_for("Academic Ascent", corner)
    assert readings[0]["name"] == "Academic Ascent"
    assert readings[0]["printing"] is None


def test_a_corner_never_pins_a_reading_under_accept() -> None:
    with closing(db.connect()) as conn:
        insert_card(conn, "ring", "Sol Ring", set_code="c21", collector_number="263")
        insert_card(conn, "talisman", "Sol Talisman", set_code="mh1", collector_number="112")
        conn.commit()
    # A line confidence of 0 shades the exact second name to 0.70.
    title = [line("Sol Ring", 0.1), line("Sol Talisman", 0.15, confidence=0.0)]
    _fit(FakeOcr(title, corner=[corner_line("R 0112", 0.93), corner_line("MH1 • EN", 0.95)]))
    status, payload = _post(JPEG, "image/jpeg")
    assert status == 200
    readings = payload["readings"]
    assert [(r["name"], r["confidence"]) for r in readings] == [
        ("Sol Ring", 1.0),
        ("Sol Talisman", 0.7),
    ]
    assert all(r["printing"] is None for r in readings)


def test_a_lone_year_read_before_the_number_still_pins() -> None:
    corner = [corner_line("2024", 0.91), *FRA_2]
    readings = _readings_for("Academic Ascent", corner)
    assert readings[0]["printing"]["scryfall_id"] == "ascent"


def test_a_number_the_catalog_stores_padded_pins_as_read() -> None:
    with closing(db.connect()) as conn:
        insert_card(conn, "padded", "Padded Promo", set_code="ppad", collector_number="001")
        conn.commit()
    readings = _readings_for(
        "Padded Promo", [corner_line("C 001", 0.93), corner_line("PPAD • EN", 0.95)]
    )
    assert readings[0]["printing"]["scryfall_id"] == "padded"


def test_a_lowercase_suffix_read_as_a_capital_still_pins() -> None:
    with closing(db.connect()) as conn:
        insert_card(conn, "bolt-221a", "Lightning Bolt", set_code="2x2", collector_number="221a")
        conn.commit()
    corner = [corner_line("R 221A", 0.93), corner_line("2X2 • EN", 0.95)]
    readings = _readings_for("Lightning Bolt", corner)
    assert readings[0]["printing"]["scryfall_id"] == "bolt-221a"


def test_a_promo_printed_with_the_same_corner_pins_nothing() -> None:
    with closing(db.connect()) as conn:
        insert_card(conn, "ring", "Sol Ring", set_code="c21", collector_number="263")
        insert_card(conn, "ring-s", "Sol Ring", set_code="pc21", collector_number="263s")
        conn.commit()
    corner = [corner_line("U 0263", 0.93), corner_line("C21 • EN", 0.95)]
    readings = _readings_for("Sol Ring", corner)
    assert readings[0]["name"] == "Sol Ring"
    assert all(r["printing"] is None for r in readings)


def test_a_longer_number_in_another_set_still_lets_the_corner_pin() -> None:
    with closing(db.connect()) as conn:
        insert_card(conn, "island-fdn", "Island", set_code="fdn", collector_number="275")
        insert_card(conn, "island-sld", "Island", set_code="sld", collector_number="2755")
        conn.commit()
    corner = [corner_line("L 0275", 0.93), corner_line("FDN • EN", 0.95)]
    readings = _readings_for("Island", corner)
    assert readings[0]["printing"]["scryfall_id"] == "island-fdn"


def test_a_list_reprint_printed_with_the_same_corner_pins_nothing() -> None:
    with closing(db.connect()) as conn:
        insert_card(conn, "bolt-m21", "Lightning Bolt", set_code="m21", collector_number="152")
        insert_card(
            conn, "bolt-plst", "Lightning Bolt", set_code="plst", collector_number="M21-152"
        )
        conn.commit()
    corner = [corner_line("C 0152", 0.93), corner_line("M21 • EN", 0.95)]
    readings = _readings_for("Lightning Bolt", corner)
    assert readings[0]["name"] == "Lightning Bolt"
    assert all(r["printing"] is None for r in readings)


def test_the_printing_attaches_to_the_reading_it_names() -> None:
    with closing(db.connect()) as conn:
        insert_card(conn, "ring", "Sol Ring", set_code="c21", collector_number="263")
        insert_card(conn, "talisman", "Sol Talisman", set_code="mh1", collector_number="112")
        conn.commit()
    title = [line("Sol Ring", 0.1), line("Sol Talisman", 0.15)]
    corner = [corner_line("R 0112", 0.93), corner_line("MH1 • EN", 0.95)]
    _fit(FakeOcr(title, corner=corner))
    status, payload = _post(JPEG, "image/jpeg")
    assert status == 200
    readings = payload["readings"]
    assert [(r["name"], r["confidence"]) for r in readings] == [
        ("Sol Ring", 1.0),
        ("Sol Talisman", 1.0),
    ]
    assert readings[0]["printing"] is None
    assert readings[1]["printing"]["scryfall_id"] == "talisman"


def test_the_first_candidate_that_pins_wins() -> None:
    with closing(db.connect()) as conn:
        insert_card(conn, "ascent-2024", "Academic Ascent", set_code="fra", collector_number="2024")
        conn.commit()
    readings = _readings_for("Academic Ascent", [corner_line("2024", 0.91), *FRA_2])
    assert readings[0]["printing"]["scryfall_id"] == "ascent"


@pytest.mark.parametrize(
    "error", [OcrUnavailable("Vision failed"), UnreadableImage("bad bytes")], ids=type
)
def test_a_failed_corner_read_still_answers_the_name(error: Exception) -> None:
    _fit(FakeOcr([line("Academic Ascent", 0.1)], corner=FRA_2, corner_raise=error))
    status, payload = _post(JPEG, "image/jpeg")
    assert status == 200
    assert payload["readings"][0]["name"] == "Academic Ascent"
    assert all(r["printing"] is None for r in payload["readings"])


def test_a_locked_catalog_at_the_corner_lookup_still_answers_the_name(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    def locked(*_: object) -> list[dict[str, Any]]:
        raise sqlite3.OperationalError("database is locked")

    monkeypatch.setattr("scriptorium.catalog.printings_by_number", locked)
    readings = _readings_for("Academic Ascent", FRA_2)
    assert readings[0]["name"] == "Academic Ascent"
    assert all(r["printing"] is None for r in readings)
    assert any(r.levelname == "WARNING" for r in caplog.records)


def test_no_engine_answers_unavailable() -> None:
    _fit(None)
    assert _recognize(JPEG, "image/jpeg") == (503, NO_ENGINE)


def test_an_empty_body_is_checked_before_the_engine() -> None:
    _fit(None)
    assert _recognize(b"", "image/jpeg") == (400, "The image was empty.")


def test_a_declared_length_is_checked_before_the_engine() -> None:
    _fit(None)
    resp = client.post(
        "/scanner/recognize",
        content=JPEG,
        headers={"Content-Type": "image/jpeg", "Content-Length": str(MAX_IMAGE_BYTES + 1)},
    )
    assert (resp.status_code, resp.json()["detail"]) == (413, TOO_LARGE)


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
    monkeypatch.setenv("SCRIPTORIUM_OCR", "paddle")
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
def test_startup_off_macos_never_probes_a_real_tesseract(monkeypatch: pytest.MonkeyPatch) -> None:
    # On Linux with tesseract installed, auto would probe the real binary at
    # startup. The conftest hides it outside the tesseract marker, so the app
    # starts with no engine.
    monkeypatch.delenv("SCRIPTORIUM_OCR", raising=False)
    monkeypatch.setattr(sys, "platform", "linux")
    with TestClient(app) as started:
        assert started.get("/").status_code == 200
    assert select_engine() is None


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
