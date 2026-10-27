"""Pick the lines most likely to be a card's title (VEG-231, ADR 0026)."""

from __future__ import annotations

from scriptorium.scanner.names import fold
from scriptorium.scanner.ocr import TextLine

# A title has at least three letters, which drops stray digits and collector
# numbers. "Opt" is a real three-letter name, so the bar cannot go higher.
_MIN_LETTERS = 3
# A mana cost read on its own, such as "3BRW", can still carry three letters.
# Titles are printed in title case, so a line of nothing but digits and
# upper-case mana letters is the cost, not the name.
_MANA_COST_CHARS = frozenset("0123456789WUBRGCX{}/")
# The title is centred on a card lined up to the guide. Lines centred near the
# frame's edges are background, a hand, or a neighbouring card.
_BAND_LEFT = 0.15
_BAND_RIGHT = 0.85


def _letters(text: str) -> int:
    # Counted after fold, so "0pt" read for "Opt" keeps its three letters,
    # the same repair the name match makes. Fold also turns 1, 0, 5 and ! into
    # letters, so a line with no real letter, such as "100,000", counts none.
    if not any(ch.isalpha() for ch in text):
        return 0
    return sum(ch.isalpha() for ch in fold(text))


def _is_mana_cost(text: str) -> bool:
    chars = set(text) - {" "}
    return bool(chars) and chars <= _MANA_COST_CHARS


def pick_title_candidates(lines: list[TextLine], *, max_candidates: int = 3) -> list[TextLine]:
    """The lines to try as a title, best guess first.

    The title is the top line of the card and set larger than the type line
    and rules text, so the top-most lines come first and the taller line wins
    a tie.
    """
    kept = [
        ln
        for ln in lines
        if _letters(ln.text) >= _MIN_LETTERS
        and not _is_mana_cost(ln.text)
        and _BAND_LEFT <= ln.box.x + ln.box.width / 2 <= _BAND_RIGHT
    ]
    kept.sort(key=lambda ln: (ln.box.y, -ln.box.height))
    return kept[:max_candidates]
