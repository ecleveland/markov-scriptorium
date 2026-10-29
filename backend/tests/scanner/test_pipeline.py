"""Tests for the recognition pipeline and engine selection (VEG-231, VEG-653, ADR 0026, ADR 0027).

The pipeline runs against FakeOcr and a real NameIndex over a seeded catalog.
"""

from __future__ import annotations

import sys
from collections.abc import Iterator
from contextlib import closing
from importlib.util import find_spec
from pathlib import Path

import pytest

from scriptorium import db
from scriptorium.scanner.engines import select_engine
from scriptorium.scanner.names import NameIndex, invalidate, name_index
from scriptorium.scanner.ocr import OcrUnavailable, UnreadableImage
from scriptorium.scanner.pipeline import ACCEPT, FALLBACK_WEIGHT, Reading, recognize
from scriptorium.scanner.printing import CornerRead, corner_region
from scriptorium.scanner.region import title_region
from tests.scanner.fakes import FakeOcr, corner_line, insert_card, line, seed_catalog

IMAGE = b"\x89PNG\r\n\x1a\n"
EDGAR = line("Edgar Markov", 0.1)
NOISE = line("Lifelink. Whenever another nontoken", 0.2)


@pytest.fixture
def index(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[NameIndex]:
    monkeypatch.setenv("SCRIPTORIUM_DB_PATH", str(tmp_path / "catalog.db"))
    seed_catalog(
        ("edgar", "Edgar Markov"),
        ("elves", "Llanowar Elves"),
        *(
            (f"lightning-{i}", f"Lightning {word}")
            for i, word in enumerate(("Bolt", "Helix", "Axe", "Strike", "Blast", "Greaves"))
        ),
    )
    invalidate()
    yield name_index()
    invalidate()


def test_an_upright_hit_reads_the_title_region_once(index: NameIndex) -> None:
    ocr = FakeOcr([EDGAR])
    assert recognize(IMAGE, ocr, index).readings == [Reading("Edgar Markov", 1.0)]
    assert ocr.calls == [(False, title_region()), (False, corner_region())]


def test_line_confidence_shades_the_reading(index: NameIndex) -> None:
    ocr = FakeOcr([line("Edgar Markov", 0.1, confidence=0.5)])
    assert recognize(IMAGE, ocr, index).readings == [Reading("Edgar Markov", 0.85)]
    assert ocr.calls == [(False, title_region()), (False, corner_region())]


def test_an_upside_down_card_is_read_on_the_second_pass(index: NameIndex) -> None:
    ocr = FakeOcr([NOISE], upside_down=[EDGAR])
    assert recognize(IMAGE, ocr, index).readings == [Reading("Edgar Markov", 1.0)]
    assert ocr.calls == [(False, title_region()), (True, title_region()), (True, corner_region())]


def test_a_weak_reading_and_a_strong_one_merge_to_the_best(index: NameIndex) -> None:
    weak = line("Edgar Markov", 0.1, confidence=0.0)
    ocr = FakeOcr([weak], upside_down=[EDGAR])
    assert recognize(IMAGE, ocr, index).readings == [Reading("Edgar Markov", 1.0)]


def test_the_full_frame_is_read_last_and_weighed_down(index: NameIndex) -> None:
    ocr = FakeOcr([], upside_down=[], full_frame=[line("Edgar Markov", 0.4, confidence=0.5)])
    readings = recognize(IMAGE, ocr, index).readings
    assert ocr.calls == [(False, title_region()), (True, title_region()), (False, None)]
    assert [r.name for r in readings] == ["Edgar Markov"]
    assert readings[0].confidence == pytest.approx(FALLBACK_WEIGHT * 0.85, abs=1e-3)
    assert FALLBACK_WEIGHT == 0.9


def test_merging_passes_keeps_the_better_reading(index: NameIndex) -> None:
    # A line confidence of 1/6 shades a perfect match to 0.75, under ACCEPT,
    # so every pass runs. The full frame then finds Edgar at 0.63.
    first = line("Edgar Markov", 0.1, confidence=1 / 6)
    ocr = FakeOcr([first], full_frame=[line("Edgar Markov", 0.1, confidence=0.0)])
    assert recognize(IMAGE, ocr, index).readings == [Reading("Edgar Markov", 0.75)]
    assert len(ocr.calls) == 3


def test_merging_lines_in_one_pass_keeps_the_better_reading(index: NameIndex) -> None:
    ocr = FakeOcr([EDGAR, line("Edgar Markow", 0.2, confidence=0.0)])
    assert recognize(IMAGE, ocr, index).readings == [Reading("Edgar Markov", 1.0)]


def test_readings_under_the_floor_are_dropped(index: NameIndex) -> None:
    # A ratio of 0.80 at line confidence 0 shades to 0.56.
    dropped = FakeOcr([line("Uanowar Eloes", 0.1, confidence=0.0)])
    assert recognize(IMAGE, dropped, index).readings == []


def test_readings_just_over_the_floor_are_kept(index: NameIndex) -> None:
    # A ratio of 0.88 at line confidence 0 shades to about 0.62.
    kept = FakeOcr([line("Uanowar Elves", 0.1, confidence=0.0)])
    assert [r.name for r in recognize(IMAGE, kept, index).readings] == ["Llanowar Elves"]


def test_a_reading_just_over_accept_stops_after_one_title_read(index: NameIndex) -> None:
    ocr = FakeOcr([line("Edgar Markov", 0.1, confidence=0.4)])
    assert recognize(IMAGE, ocr, index).readings == [Reading("Edgar Markov", 0.82)]
    assert ocr.calls == [(False, title_region()), (False, corner_region())]


def test_a_reading_just_under_accept_reads_every_pass(index: NameIndex) -> None:
    ocr = FakeOcr([line("Edgar Markov", 0.1, confidence=0.3)])
    assert recognize(IMAGE, ocr, index).readings == [Reading("Edgar Markov", 0.79)]
    assert len(ocr.calls) == 3


def test_a_full_read_outranks_a_shorter_name_found_by_trimming(index: NameIndex) -> None:
    # Both score 1.0. The order the name index ranks them in must survive the
    # pipeline's merge and sort.
    with closing(db.connect()) as conn:
        insert_card(conn, "nicol", "Nicol Bolas")
        insert_card(conn, "ravager", "Nicol Bolas, the Ravager")
        conn.commit()
    ocr = FakeOcr([line("Nicol Bolas, the Ravager", 0.1)])
    assert recognize(IMAGE, ocr, name_index()).readings == [
        Reading("Nicol Bolas, the Ravager", 1.0),
        Reading("Nicol Bolas", 1.0),
    ]


def test_garbage_reads_as_no_readings(index: NameIndex) -> None:
    ocr = FakeOcr([NOISE], upside_down=[NOISE], full_frame=[NOISE])
    assert recognize(IMAGE, ocr, index).readings == []
    assert len(ocr.calls) == 3


def test_readings_are_capped_best_first_without_repeats(index: NameIndex) -> None:
    ocr = FakeOcr([line("Lightning", 0.1), line("Lightning Bolt", 0.2)])
    readings = recognize(IMAGE, ocr, index).readings
    names = [r.name for r in readings]
    assert len(readings) == 5
    assert len(set(names)) == 5
    assert readings[0] == Reading("Lightning Bolt", 1.0)
    keys = [(-r.confidence, r.name) for r in readings]
    assert keys == sorted(keys)
    assert all(0.6 <= r.confidence <= 1 for r in readings)
    assert recognize(IMAGE, ocr, index, limit=2).readings == readings[:2]


def test_confidence_is_rounded_to_three_places(index: NameIndex) -> None:
    ocr = FakeOcr([line("Uanowar Elves", 0.1, confidence=0.9)])
    (reading,) = recognize(IMAGE, ocr, index).readings
    assert reading.confidence == round(reading.confidence, 3)


def test_an_unreadable_image_propagates(index: NameIndex) -> None:
    with pytest.raises(UnreadableImage):
        recognize(IMAGE, FakeOcr([], raise_=UnreadableImage("bad bytes")), index)


# --- the corner -----------------------------------------------------------

CORNER = [corner_line("C 0002", 0.93), corner_line("FRA • EN", 0.95)]


def test_a_confident_title_reads_the_corner_once(index: NameIndex) -> None:
    ocr = FakeOcr([EDGAR], corner=CORNER)
    result = recognize(IMAGE, ocr, index)
    assert result.readings == [Reading("Edgar Markov", 1.0)]
    assert result.corner == CornerRead(("2", "0002"), "fra")
    assert len(ocr.calls) == 2
    upside_down, region = ocr.calls[1]
    assert upside_down is False
    assert region is not None
    assert region.y >= 0.5


def test_a_weak_title_never_reads_the_corner(index: NameIndex) -> None:
    ocr = FakeOcr([line("Edgar Markov", 0.1, confidence=0.3)], corner=CORNER)
    result = recognize(IMAGE, ocr, index)
    assert result.readings[0].confidence < ACCEPT
    assert result.corner is None
    assert all(region is None or region.y < 0.5 for _, region in ocr.calls)


def test_no_title_never_reads_the_corner(index: NameIndex) -> None:
    ocr = FakeOcr([NOISE], upside_down=[NOISE], full_frame=[NOISE], corner=CORNER)
    result = recognize(IMAGE, ocr, index)
    assert result.readings == []
    assert result.corner is None
    assert len(ocr.calls) == 3


def test_an_upside_down_card_reads_its_corner_turned(index: NameIndex) -> None:
    ocr = FakeOcr([NOISE], upside_down=[EDGAR], corner=CORNER)
    result = recognize(IMAGE, ocr, index)
    assert result.corner == CornerRead(("2", "0002"), "fra")
    assert ocr.calls[-1] == (True, corner_region())


def test_a_card_found_in_the_full_frame_never_reads_the_corner(index: NameIndex) -> None:
    # The card is off the guide, so the guide's corner region would read
    # whatever else is in the bottom of the frame.
    ocr = FakeOcr([], upside_down=[], full_frame=[line("Edgar Markov", 0.4)], corner=CORNER)
    result = recognize(IMAGE, ocr, index)
    assert result.readings == [Reading("Edgar Markov", FALLBACK_WEIGHT)]
    assert result.corner is None
    assert ocr.calls == [(False, title_region()), (True, title_region()), (False, None)]


def test_a_corner_that_does_not_parse_leaves_the_readings_alone(index: NameIndex) -> None:
    ocr = FakeOcr([EDGAR], corner=[corner_line("Randy Gallegos", 0.95)])
    result = recognize(IMAGE, ocr, index)
    assert result.readings == [Reading("Edgar Markov", 1.0)]
    assert result.corner is None
    assert len(ocr.calls) == 2


@pytest.mark.parametrize(
    "error", [OcrUnavailable("Vision failed"), UnreadableImage("bad bytes")], ids=type
)
def test_a_failed_corner_read_never_costs_the_name(
    index: NameIndex, error: Exception, caplog: pytest.LogCaptureFixture
) -> None:
    ocr = FakeOcr([EDGAR], corner=CORNER, corner_raise=error)
    result = recognize(IMAGE, ocr, index)
    assert result.readings == [Reading("Edgar Markov", 1.0)]
    assert result.corner is None
    assert len(ocr.calls) == 2
    assert any(r.levelname == "WARNING" for r in caplog.records)


# --- select_engine ------------------------------------------------------------


@pytest.fixture
def fresh_selection() -> Iterator[None]:
    select_engine.cache_clear()
    yield
    select_engine.cache_clear()


@pytest.mark.usefixtures("fresh_selection")
def test_none_selects_no_engine(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SCRIPTORIUM_OCR", "none")
    assert select_engine() is None


@pytest.mark.usefixtures("fresh_selection")
def test_an_unknown_engine_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SCRIPTORIUM_OCR", "tesseract")
    with pytest.raises(OcrUnavailable, match="tesseract"):
        select_engine()


@pytest.mark.usefixtures("fresh_selection")
def test_auto_selects_nothing_off_macos(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SCRIPTORIUM_OCR", raising=False)
    monkeypatch.setattr(sys, "platform", "linux")
    assert select_engine() is None


@pytest.mark.usefixtures("fresh_selection")
def test_an_empty_setting_means_auto(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SCRIPTORIUM_OCR", "")
    monkeypatch.setattr(sys, "platform", "linux")
    assert select_engine() is None


@pytest.mark.usefixtures("fresh_selection")
def test_auto_selects_nothing_when_vision_will_not_import(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("SCRIPTORIUM_OCR", "auto")
    monkeypatch.setattr(sys, "platform", "darwin")
    # A None entry in sys.modules makes the import raise ImportError.
    monkeypatch.setitem(sys.modules, "scriptorium.scanner.engines.vision", None)
    assert select_engine() is None


@pytest.mark.usefixtures("fresh_selection")
def test_asking_for_vision_when_it_will_not_import_is_refused(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("SCRIPTORIUM_OCR", "vision")
    monkeypatch.setitem(sys.modules, "scriptorium.scanner.engines.vision", None)
    with pytest.raises(OcrUnavailable):
        select_engine()


@pytest.mark.usefixtures("fresh_selection")
@pytest.mark.skipif(
    sys.platform != "darwin" or find_spec("Vision") is None, reason="needs macOS with pyobjc"
)
def test_auto_selects_vision_on_macos(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SCRIPTORIUM_OCR", "Auto ")
    engine = select_engine()
    assert engine is not None
    assert engine.name == "vision"
    assert select_engine() is engine
