"""Tesseract read real pixels (VEG-649, ADR 0028).

These run the real binary on the same drawn cards the Vision tests read, so
they run only where tesseract is installed, under the tesseract marker.
"""

from __future__ import annotations

import pytest

from scriptorium.scanner.engines.tesseract import TesseractOcr, find_tesseract, probe
from scriptorium.scanner.ocr import TextLine
from scriptorium.scanner.printing import corner_region, parse_corner
from scriptorium.scanner.region import title_region
from tests.scanner.drawn import TYPE_LINE, card, cornered_card, png


def _usable() -> str | None:
    # A stale SCRIPTORIUM_TESSERACT or a missing eng model skips, not fails.
    binary = find_tesseract()
    return None if binary is None else probe(binary)


pytestmark = [
    pytest.mark.tesseract,
    pytest.mark.skipif(
        _usable() is None,
        reason="needs a tesseract with the eng model, on PATH or in SCRIPTORIUM_TESSERACT",
    ),
]


def _engine() -> TesseractOcr:
    binary = _usable()
    assert binary is not None
    return TesseractOcr(binary)


def _find(lines: list[TextLine], text: str) -> TextLine:
    matches = [ln for ln in lines if ln.text == text]
    assert matches, f"{text!r} not in {[ln.text for ln in lines]}"
    return matches[0]


def _same_place(a: TextLine, b: TextLine) -> None:
    got = (a.box.x, a.box.y, a.box.width, a.box.height)
    want = (b.box.x, b.box.y, b.box.width, b.box.height)
    assert got == pytest.approx(want, abs=0.02)


def test_reads_the_title_from_the_title_region() -> None:
    image = png(card())
    title = _find(_engine().read_lines(image, region=title_region()), "Edgar Markov")
    assert title.box.y < 0.3
    assert title.confidence > 0.8
    # The region read is cropped, upscaled and padded. Mapped back, its box
    # must land where the whole-frame read puts the same title.
    _same_place(title, _find(_engine().read_lines(image), "Edgar Markov"))


def test_reads_an_upside_down_card_when_asked_to_turn_it() -> None:
    flipped = png(card().rotate(180))
    lines = _engine().read_lines(flipped, upside_down=True, region=title_region())
    title = _find(lines, "Edgar Markov")
    assert title.box.y < 0.3
    assert title.confidence > 0.8


def test_a_full_frame_read_finds_the_type_line_below_the_title() -> None:
    lines = _engine().read_lines(png(card()))
    title = _find(lines, "Edgar Markov")
    assert _find(lines, TYPE_LINE).box.y > title.box.y


def test_cannot_read_the_corner_of_a_card_at_1080p() -> None:
    """Tesseract reads nothing usable in 16 px white text on a dark border.

    The smoke check tried psm 6 and 11, upright and inverted, and none gave a
    collector number and set code. So the corner pin needs Vision for now
    (ADR 0028). This test pins the gap so an improvement shows up as a
    failure to update, not as silence.
    """
    lines = _engine().read_lines(png(cornered_card()), region=corner_region())
    assert parse_corner(lines) is None
