"""Frame geometry for the recognition pipeline (VEG-231, ADR 0026).

Pure maths with no engine imports. Boxes are fractions of the frame with a
top-left origin. Vision measures from the bottom left, so the adapter flips
through here.
"""

from __future__ import annotations

from scriptorium.scanner.ocr import Box

# A card lined up to the page's guide sits in the centre of the frame and
# fills most of its height. Half the card's width is a little under 0.40 of
# the frame height, so this half-width keeps the whole title bar in view.
_HALF_WIDTH_OF_HEIGHT = 0.40
# The title bar sits in the top 8 to 16 percent of the frame. Reading the top
# 30 percent leaves slack for a card held high or tilted.
_TITLE_DEPTH = 0.30


def title_region(aspect: float = 4 / 3) -> Box:
    """The part of the frame the title bar should fall in.

    ``aspect`` is the frame's width over its height. The engine sees only
    fractions, so a length measured in frame heights is divided by it to
    become a fraction of the width.
    """
    half_width = min(_HALF_WIDTH_OF_HEIGHT / aspect, 0.5)
    return Box(x=0.5 - half_width, y=0.0, width=2 * half_width, height=_TITLE_DEPTH)


def to_top_left(x: float, y: float, width: float, height: float) -> Box:
    """Flip a bottom-left origin rectangle, as Vision reports it, to a Box."""
    return Box(x=x, y=1 - (y + height), width=width, height=height)


def to_bottom_left(box: Box) -> tuple[tuple[float, float], tuple[float, float]]:
    """The ``((x, y), (width, height))`` Vision wants for a region of interest."""
    return ((box.x, 1 - (box.y + box.height)), (box.width, box.height))


def unscale(box_in_region: Box, region: Box) -> Box:
    """Map a box measured inside ``region`` back to fractions of the frame.

    Vision reports boxes relative to the region of interest when one is set.
    """
    return Box(
        x=region.x + box_in_region.x * region.width,
        y=region.y + box_in_region.y * region.height,
        width=box_in_region.width * region.width,
        height=box_in_region.height * region.height,
    )
