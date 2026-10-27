"""Turn a webcam still into ranked card names (VEG-231, ADR 0026).

Reads go cheapest first and stop once one is good enough. First comes the
title region as captured, then the same region turned half a turn for a card
held upside down, then the whole frame for a card held off the guide.
"""

from __future__ import annotations

from dataclasses import dataclass

from scriptorium.scanner.names import NameIndex
from scriptorium.scanner.ocr import Box, Ocr
from scriptorium.scanner.region import title_region
from scriptorium.scanner.title import pick_title_candidates

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


@dataclass(frozen=True, slots=True)
class Reading:
    """A card name the still could show, with confidence from 0 to 1."""

    name: str
    confidence: float


def _read(
    image: bytes,
    ocr: Ocr,
    index: NameIndex,
    *,
    upside_down: bool,
    region: Box | None,
    weight: float,
) -> dict[str, float]:
    found: dict[str, float] = {}
    lines = ocr.read_lines(image, upside_down=upside_down, region=region)
    for candidate in pick_title_candidates(lines):
        line_confidence = min(max(candidate.confidence, 0.0), 1.0)
        shade = _MATCH_SHARE + (1 - _MATCH_SHARE) * line_confidence
        for name, ratio in index.match(candidate.text):
            found[name] = max(found.get(name, 0.0), ratio * shade * weight)
    return found


def recognize(image: bytes, ocr: Ocr, index: NameIndex, *, limit: int = 5) -> list[Reading]:
    """Read the card name off ``image``, best reading first.

    Returns at most ``limit`` readings and an empty list when nothing
    matched. Engine errors such as UnreadableImage pass through.
    """
    # Without decoding the image the frame's aspect is unknown. The 4:3
    # default gives a wider region than a 16:9 frame needs, which only adds
    # slack.
    region = title_region()
    passes = ((False, region, 1.0), (True, region, 1.0), (False, None, FALLBACK_WEIGHT))
    best: dict[str, float] = {}
    for upside_down, read_region, weight in passes:
        found = _read(image, ocr, index, upside_down=upside_down, region=read_region, weight=weight)
        for name, confidence in found.items():
            best[name] = max(best.get(name, 0.0), confidence)
        if best and max(best.values()) >= ACCEPT:
            break
    # Round before ranking so the order matches the numbers the page shows.
    rounded = [(name, round(c, 3)) for name, c in best.items()]
    kept = sorted(
        ((name, c) for name, c in rounded if c >= FLOOR), key=lambda item: (-item[1], item[0])
    )
    return [Reading(name, confidence) for name, confidence in kept[:limit]]
