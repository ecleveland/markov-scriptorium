"""Turn a webcam still into ranked card names and a corner read (VEG-231, VEG-653).

The title reads (ADR 0026) go cheapest first and stop once one is good
enough. First comes the title region as captured, then the same region turned
half a turn for a card held upside down, then the whole frame for a card held
off the guide.

Once a title read is good enough, one more read takes the card's bottom-left
corner the same way up (ADR 0027). Its collector number and set code let the
caller pin the exact printing of a name already read. A weak title skips it,
because a pinned printing of a doubtful name would only mislead. So does a
title found only by the whole-frame read, because that card is off the guide
the corner region follows. The corner never costs the name, so an engine
error on that read leaves the corner unread.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from scriptorium.scanner.names import NameIndex
from scriptorium.scanner.ocr import Box, Ocr, OcrUnavailable, UnreadableImage
from scriptorium.scanner.printing import CornerRead, corner_region, parse_corner
from scriptorium.scanner.region import title_region
from scriptorium.scanner.title import pick_title_candidates

logger = logging.getLogger(__name__)

# Stop reading once the best reading reaches this.
ACCEPT = 0.80
# Readings under this are guesses the user would only have to dismiss.
FLOOR = 0.60
# A whole-frame read can pick up text that is not the title, so its readings
# rank below an equally good read of the title region.
FALLBACK_WEIGHT = 0.9

# Vision's line confidence is coarse, so the name match carries most of the
# weight and a doubtful line costs at most 30 percent.
_MATCH_SHARE = 0.7


# Per name, (confidence, -position) where position is the name's place in the
# list NameIndex.match ranked for the line. Equal confidences then keep the
# index's order, which prefers the match that used more of the read text.
_Rank = tuple[float, int]


@dataclass(frozen=True, slots=True)
class Reading:
    """A card name the still could show, with confidence from 0 to 1."""

    name: str
    confidence: float


@dataclass(frozen=True, slots=True)
class Recognition:
    """The readings, best first, and the corner when it was read and parsed."""

    readings: list[Reading]
    corner: CornerRead | None


def _read(
    image: bytes,
    ocr: Ocr,
    index: NameIndex,
    *,
    upside_down: bool,
    region: Box | None,
    weight: float,
) -> dict[str, _Rank]:
    found: dict[str, _Rank] = {}
    lines = ocr.read_lines(image, upside_down=upside_down, region=region)
    for candidate in pick_title_candidates(lines):
        line_confidence = min(max(candidate.confidence, 0.0), 1.0)
        shade = _MATCH_SHARE + (1 - _MATCH_SHARE) * line_confidence
        for position, (name, ratio) in enumerate(index.match(candidate.text)):
            _keep_better(found, name, (ratio * shade * weight, -position))
    return found


def _keep_better(ranks: dict[str, _Rank], name: str, rank: _Rank) -> None:
    held = ranks.get(name)
    ranks[name] = rank if held is None else max(held, rank)


def _read_corner(image: bytes, ocr: Ocr, *, upside_down: bool) -> CornerRead | None:
    try:
        lines = ocr.read_lines(image, upside_down=upside_down, region=corner_region())
    except (OcrUnavailable, UnreadableImage):
        # The name is already read, and the picker still finds its printing.
        logger.warning("the corner read failed; the name stands alone", exc_info=True)
        return None
    return parse_corner(lines)


def recognize(image: bytes, ocr: Ocr, index: NameIndex, *, limit: int = 5) -> Recognition:
    """Read the card name off ``image``, best reading first, and its corner.

    Returns at most ``limit`` readings and an empty list when nothing
    matched. The corner is None unless a title region read reached ACCEPT,
    the engine reads corners, and the corner's lines parsed. Engine errors
    such as UnreadableImage from the title reads pass through. From the
    corner read they are logged and the corner is None.
    """
    # Without decoding the image the frame's aspect is unknown. The 4:3
    # default gives a wider region than a 16:9 frame needs, which only adds
    # slack.
    region = title_region()
    passes = ((False, region, 1.0), (True, region, 1.0), (False, None, FALLBACK_WEIGHT))
    best: dict[str, _Rank] = {}
    # The way up of the pass that reached ACCEPT. That pass holds the best
    # reading, because an earlier one at ACCEPT would have stopped the loop.
    # It stays None for the whole-frame pass: that card is off the guide, so
    # the guide's corner region would read whatever else the frame holds.
    accepted_upside_down: bool | None = None
    for upside_down, read_region, weight in passes:
        found = _read(image, ocr, index, upside_down=upside_down, region=read_region, weight=weight)
        for name, rank in found.items():
            _keep_better(best, name, rank)
        if best and max(c for c, _ in best.values()) >= ACCEPT:
            if read_region is not None:
                accepted_upside_down = upside_down
            break
    corner: CornerRead | None = None
    if accepted_upside_down is not None and ocr.reads_corners:
        corner = _read_corner(image, ocr, upside_down=accepted_upside_down)
    # Round before ranking so the order matches the numbers the page shows.
    rounded = [(round(c, 3), -neg_position, name) for name, (c, neg_position) in best.items()]
    kept = sorted(
        (item for item in rounded if item[0] >= FLOOR),
        key=lambda item: (-item[0], item[1], item[2]),
    )
    readings = [Reading(name, confidence) for confidence, _, name in kept[:limit]]
    return Recognition(readings=readings, corner=corner)
