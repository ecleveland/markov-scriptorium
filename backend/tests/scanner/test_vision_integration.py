"""Apple Vision read real pixels (VEG-231, VEG-653, ADR 0026, ADR 0027).

These drive the real engine on a drawn card, so they run only on macOS with
pyobjc, under the vision marker.
"""

from __future__ import annotations

import importlib.util
import sys
from typing import TYPE_CHECKING

import pytest

from scriptorium.scanner.ocr import OcrUnavailable, TextLine, UnreadableImage
from scriptorium.scanner.printing import CornerRead, corner_region, parse_corner
from scriptorium.scanner.region import title_region
from tests.scanner.drawn import TYPE_LINE, card, cornered_card, png

if TYPE_CHECKING:
    from scriptorium.scanner.engines.vision import VisionOcr

pytestmark = [
    pytest.mark.vision,
    pytest.mark.skipif(
        sys.platform != "darwin" or importlib.util.find_spec("Vision") is None,
        reason="Apple Vision needs macOS with pyobjc-framework-Vision",
    ),
]


def _find(lines: list[TextLine], text: str) -> TextLine:
    matches = [ln for ln in lines if ln.text == text]
    assert matches, f"{text!r} not in {[ln.text for ln in lines]}"
    return matches[0]


def _engine() -> VisionOcr:
    # Imported late, so collection on other platforms reaches the skip.
    from scriptorium.scanner.engines.vision import VisionOcr

    return VisionOcr()


def _same_place(a: TextLine, b: TextLine) -> None:
    got = (a.box.x, a.box.y, a.box.width, a.box.height)
    want = (b.box.x, b.box.y, b.box.width, b.box.height)
    assert got == pytest.approx(want, abs=0.01)


def test_reads_the_title_from_the_title_region() -> None:
    image = png(card())
    title = _find(_engine().read_lines(image, region=title_region()), "Edgar Markov")
    assert title.box.y < 0.3
    # Vision measures inside the region. Mapped back, the box must land where
    # a whole-frame read puts the same title.
    _same_place(title, _find(_engine().read_lines(image), "Edgar Markov"))


def test_reads_an_upside_down_card_when_asked_to_turn_it() -> None:
    upright = _find(_engine().read_lines(png(card())), "Edgar Markov")
    flipped = png(card().rotate(180))
    lines = _engine().read_lines(flipped, upside_down=True, region=title_region())
    title = _find(lines, "Edgar Markov")
    assert title.box.y < 0.3
    _same_place(title, upright)


def test_a_full_frame_read_finds_the_type_line_below_the_title() -> None:
    lines = _engine().read_lines(png(card()))
    title = _find(lines, "Edgar Markov")
    assert _find(lines, TYPE_LINE).box.y > title.box.y


def test_reads_the_corner_of_a_card_at_1080p() -> None:
    lines = _engine().read_lines(png(cornered_card()), region=corner_region())
    assert parse_corner(lines) == CornerRead(("2", "0002"), "fra")


def test_reads_the_corner_of_an_upside_down_card_when_asked_to_turn_it() -> None:
    flipped = png(cornered_card().rotate(180))
    lines = _engine().read_lines(flipped, upside_down=True, region=corner_region())
    assert parse_corner(lines) == CornerRead(("2", "0002"), "fra")


def test_vision_claims_to_read_corners() -> None:
    assert _engine().reads_corners is True


def test_bytes_vision_cannot_decode_are_unreadable() -> None:
    # The decode check catches the smoke check's bytes before Vision sees them.
    with pytest.raises(UnreadableImage, match="ImageIO"):
        _engine().read_lines(b"\xff\xd8\xff" + b"\x00" * 16)


def test_bytes_behind_an_image_header_are_unreadable() -> None:
    with pytest.raises(UnreadableImage, match="ImageIO"):
        _engine().read_lines(b"\x89PNG\r\n\x1a\n" + b"Edgar Markov is a vampire" * 4)
    with pytest.raises(UnreadableImage, match="ImageIO"):
        _engine().read_lines(b"\xff\xd8\xff\xe0" + bytes(range(256)) * 4)


class _FailingHandler:
    """Stands in for VNImageRequestHandler and fails the way Vision reports it."""

    @classmethod
    def alloc(cls) -> _FailingHandler:
        return cls()

    def initWithData_orientation_options_(  # noqa: N802
        self, data: object, orientation: int, options: object
    ) -> _FailingHandler:
        return self

    def performRequests_error_(self, requests: object, error: object) -> tuple[bool, str]:  # noqa: N802
        return (False, "boom")


class _RaisingHandler(_FailingHandler):
    """Fails the way a pyobjc bridge error surfaces, as a raised objc.error."""

    def performRequests_error_(self, requests: object, error: object) -> tuple[bool, str]:  # noqa: N802
        import objc

        raise objc.error("bridge broke")


def test_a_pyobjc_error_is_an_engine_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("Vision.VNImageRequestHandler", _RaisingHandler)
    with pytest.raises(OcrUnavailable, match="bridge broke"):
        _engine().read_lines(png(card()), region=title_region())


def test_a_vision_failure_on_a_good_image_is_an_engine_failure(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    # The engine reaches the class through the Vision module, so patch it there.
    monkeypatch.setattr("Vision.VNImageRequestHandler", _FailingHandler)
    with pytest.raises(OcrUnavailable, match="boom"):
        _engine().read_lines(png(card()), region=title_region())
    assert any(r.levelname == "ERROR" and "boom" in r.getMessage() for r in caplog.records)
