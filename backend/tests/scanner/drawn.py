"""Cards drawn with Pillow for the engine integration tests (VEG-649, ADR 0028).

Both the Vision and the Tesseract tests read these, so the two engines are
held to the same pixels.
"""

from __future__ import annotations

import io
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

_GEORGIA = Path("/System/Library/Fonts/Supplemental/Georgia.ttf")
_ARIAL = Path("/System/Library/Fonts/Supplemental/Arial.ttf")
WIDTH, HEIGHT = 1280, 960
TYPE_LINE = "Legendary Creature Vampire Knight"

# The page's 1080p capture, the frame the corner has to be legible in.
FRAME_WIDTH, FRAME_HEIGHT = 1920, 1080
# The corner text at 1080p on a card lined up to the guide. Vision misread the
# rarity letter at 14 px, so this is the smallest size the parser is held to.
CORNER_PX = 16


def _font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    if _GEORGIA.exists():
        return ImageFont.truetype(str(_GEORGIA), size)
    return ImageFont.load_default(size=size)


def _arial(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    if _ARIAL.exists():
        return ImageFont.truetype(str(_ARIAL), size)
    return ImageFont.load_default(size=size)


def card() -> Image.Image:
    """A card centred in a 4:3 frame, lined up the way the page's guide asks."""
    img = Image.new("RGB", (WIDTH, HEIGHT), "white")
    draw = ImageDraw.Draw(img)
    draw.rectangle((340, 40, 940, 920), outline="black", width=6)
    draw.text((WIDTH // 2, 100), "Edgar Markov", font=_font(48), fill="black", anchor="mm")
    draw.text((WIDTH // 2, 540), TYPE_LINE, font=_font(32), fill="black", anchor="mm")
    return img


def cornered_card() -> Image.Image:
    """A card lined up to the 84 percent guide, white corner text on its border."""
    card_height = int(FRAME_HEIGHT * 0.84)
    card_width = int(card_height * 63 / 88)
    left, top = (FRAME_WIDTH - card_width) // 2, (FRAME_HEIGHT - card_height) // 2
    img = Image.new("RGB", (FRAME_WIDTH, FRAME_HEIGHT), (35, 35, 35))
    draw = ImageDraw.Draw(img)
    draw.rectangle(
        (left, top, left + card_width, top + card_height),
        fill=(20, 20, 20),
        outline="black",
        width=10,
    )
    draw.rectangle(
        (left + 22, top + 22, left + card_width - 22, top + card_height - 22),
        fill=(236, 230, 215),
    )
    draw.text((left + 40, top + 40), "Academic Ascent", font=_font(40), fill="black")
    small = _arial(CORNER_PX)
    number_y = top + card_height - 2 * CORNER_PX - 14
    set_y = top + card_height - CORNER_PX - 8
    draw.text((left + 30, number_y), "C 0002", font=small, fill="white")
    draw.text((left + 30, set_y), "FRA • EN", font=small, fill="white")
    draw.text((left + 150, set_y), "Randy Gallegos", font=small, fill="white")
    return img


def png(img: Image.Image) -> bytes:
    out = io.BytesIO()
    img.save(out, format="PNG")
    return out.getvalue()
