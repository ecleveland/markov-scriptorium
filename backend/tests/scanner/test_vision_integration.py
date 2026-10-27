"""Apple Vision read real pixels (VEG-231, ADR 0026).

These drive the real engine on a drawn card, so they run only on macOS with
pyobjc, under the vision marker.
"""

from __future__ import annotations

import importlib.util
import io
import sys
from pathlib import Path
from typing import TYPE_CHECKING

import pytest
from PIL import Image, ImageDraw, ImageFont

from scriptorium.scanner.ocr import OcrUnavailable, TextLine, UnreadableImage
from scriptorium.scanner.region import title_region

if TYPE_CHECKING:
    from scriptorium.scanner.engines.vision import VisionOcr

pytestmark = [
    pytest.mark.vision,
    pytest.mark.skipif(
        sys.platform != "darwin" or importlib.util.find_spec("Vision") is None,
        reason="Apple Vision needs macOS with pyobjc-framework-Vision",
    ),
]

_GEORGIA = Path("/System/Library/Fonts/Supplemental/Georgia.ttf")
WIDTH, HEIGHT = 1280, 960
TYPE_LINE = "Legendary Creature Vampire Knight"


def _font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    if _GEORGIA.exists():
        return ImageFont.truetype(str(_GEORGIA), size)
    return ImageFont.load_default(size=size)


def _card() -> Image.Image:
    """A card centred in a 4:3 frame, lined up the way the page's guide asks."""
    img = Image.new("RGB", (WIDTH, HEIGHT), "white")
    draw = ImageDraw.Draw(img)
    draw.rectangle((340, 40, 940, 920), outline="black", width=6)
    draw.text((WIDTH // 2, 100), "Edgar Markov", font=_font(48), fill="black", anchor="mm")
    draw.text((WIDTH // 2, 540), TYPE_LINE, font=_font(32), fill="black", anchor="mm")
    return img


def _png(img: Image.Image) -> bytes:
    out = io.BytesIO()
    img.save(out, format="PNG")
    return out.getvalue()


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
    png = _png(_card())
    title = _find(_engine().read_lines(png, region=title_region()), "Edgar Markov")
    assert title.box.y < 0.3
    # Vision measures inside the region. Mapped back, the box must land where
    # a whole-frame read puts the same title.
    _same_place(title, _find(_engine().read_lines(png), "Edgar Markov"))


def test_reads_an_upside_down_card_when_asked_to_turn_it() -> None:
    upright = _find(_engine().read_lines(_png(_card())), "Edgar Markov")
    flipped = _png(_card().rotate(180))
    lines = _engine().read_lines(flipped, upside_down=True, region=title_region())
    title = _find(lines, "Edgar Markov")
    assert title.box.y < 0.3
    _same_place(title, upright)


def test_a_full_frame_read_finds_the_type_line_below_the_title() -> None:
    lines = _engine().read_lines(_png(_card()))
    title = _find(lines, "Edgar Markov")
    assert _find(lines, TYPE_LINE).box.y > title.box.y


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


def test_a_vision_failure_on_a_good_image_is_an_engine_failure(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    # The engine reaches the class through the Vision module, so patch it there.
    monkeypatch.setattr("Vision.VNImageRequestHandler", _FailingHandler)
    with pytest.raises(OcrUnavailable, match="boom"):
        _engine().read_lines(_png(_card()), region=title_region())
    assert any(r.levelname == "ERROR" and "boom" in r.getMessage() for r in caplog.records)
