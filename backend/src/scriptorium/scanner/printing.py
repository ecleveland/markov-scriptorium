"""Read a card's corner to pin the exact printing (VEG-653, ADR 0027).

Below the art on the left, a card prints its rarity letter and collector
number on one line and its set code and language on the next, often with the
artist run onto the end ("C 0002" over "FRA • EN Randy Gallegos"). Reading
both pins the printing among every one of the name's printings. The name read
stays primary, so the caller only uses the pair to pick among the printings of
a name it already read.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from scriptorium.scanner.ocr import Box, TextLine
from scriptorium.scanner.region import title_region

# The collector number and set line sit in the bottom 6 percent of a card lined
# up to the guide. On a drawn 1080p card with 16 px corner text the number line
# sits near y 0.88 centred and 0.82 with the card held 60 px high. Vision is
# deterministic but sensitive to the region's shape at this text size. A top of
# 0.72 read the corner on 1 of 4 reads of a centred card (PNG and JPEG, both
# ways up). A top of 0.78 read every frame from 60 px low to 60 px high.
_CORNER_TOP = 0.78

# Vision reads the number on its own line, with the rarity letter in front and
# sometimes the set size behind ("123/280"). The rarity letter is optional
# because Vision misread it as a digit at 14 px, so it is never relied on.
_NUMBER_LINE = re.compile(r"\s*([A-Z])?\s*(\d{1,4})([a-z★]?)\s*(/\s*\d{1,4})?\s*")
_NUMBER_TOKEN = re.compile(r"(\d{1,4})([a-z★]?)|(\d{1,4})/\d{1,4}")
# A pin needs one lookup per candidate, and past three the guesses are noise.
_MAX_NUMBERS = 3
# Letters Vision reads in place of digits. Applied only to a token that
# already has a digit, so a word such as "Randy" is left alone.
_DIGIT_FOLDS = str.maketrans({"O": "0", "o": "0", "l": "1", "I": "1", "S": "5"})

# No set code is all digits, so a code needs a letter. That keeps the number
# from being taken as the set when Vision runs both lines into one.
_SET_CODE = re.compile(r"(?=[A-Z0-9]*[A-Z])[A-Z0-9]{3,6}")
# The language code and the dot between it and the set code mark the set
# line, so a three-letter word elsewhere in the corner is not taken for a set.
_LANGUAGE = "EN"
_DOTS = "•·"
_SET_LINE_SPLIT = re.compile(rf"[\s{_DOTS}]+")
# The copyright line ("™ & © 2024 Wizards of the Coast") sits in the same band
# on the right, and its year looks like a collector number.
_COPYRIGHT = re.compile(r"[©™]|\(TM\)|\bwizards\b", re.IGNORECASE)


@dataclass(frozen=True, slots=True)
class CornerRead:
    """Collector number candidates and the set code the corner showed."""

    # Up to _MAX_NUMBERS, best first and without repeats. Each number comes
    # with its leading zeros stripped, because Scryfall stores "2" where the
    # card prints "0002", and then as read when that differs, for the few
    # numbers the catalog stores padded. A letter suffix stays, lowercase.
    collector_numbers: tuple[str, ...]
    set_code: str


def corner_region(aspect: float = 4 / 3) -> Box:
    """The part of the frame the collector number and set code should fall in.

    It shares the title region's column, because the card is lined up to the
    same guide.
    """
    column = title_region(aspect)
    return Box(x=column.x, y=_CORNER_TOP, width=column.width, height=1 - _CORNER_TOP)


@dataclass(frozen=True, slots=True)
class _Number:
    digits: str
    suffix: str
    # Read beside a rarity letter or a set size, which only a collector
    # number carries. A line of bare digits can be a split-off year.
    anchored: bool = False

    def forms(self) -> list[str]:
        """The number with its zeros stripped, then as read when that differs."""
        stripped = self.digits.lstrip("0") + self.suffix
        as_read = self.digits + self.suffix
        return [stripped] if stripped == as_read else [stripped, as_read]


def _number(digits: str, suffix: str = "", *, anchored: bool = False) -> _Number | None:
    # An all-zero number is no card's collector number.
    if not digits.strip("0"):
        return None
    return _Number(digits, suffix, anchored)


def _number_in(token: str) -> _Number | None:
    if any(ch.isdigit() for ch in token):
        token = token.translate(_DIGIT_FOLDS)
    match = _NUMBER_TOKEN.fullmatch(token)
    if match is None:
        return None
    if match.group(1) is not None:
        return _number(match.group(1), match.group(2))
    return _number(match.group(3), anchored=True)


def _number_on(text: str) -> _Number | None:
    """The collector number on one line, if it has one."""
    # The whole line first and as read, so a rarity letter the digit map would
    # turn into a digit, such as the S in "S0123", is still taken as a letter.
    whole = _NUMBER_LINE.fullmatch(text)
    if whole is not None:
        anchored = whole.group(1) is not None or whole.group(4) is not None
        return _number(whole.group(2), whole.group(3), anchored=anchored)
    tokens = text.split()
    best: _Number | None = None
    for token in tokens:
        found = _number_in(token)
        # "2 0002" is the rarity letter misread as a digit, so the longest
        # run is the number. The first wins a tie.
        if found is not None and (best is None or len(found.digits) > len(best.digits)):
            best = found
    # A number read beside another token sat beside its rarity letter, however
    # misread. Alone it only counts as anchored with its set size.
    if best is not None and (len(tokens) > 1 or "/" in text):
        best = _Number(best.digits, best.suffix, anchored=True)
    return best


def _set_code_on(text: str) -> str | None:
    tokens = [token for token in _SET_LINE_SPLIT.split(text) if token]
    if _LANGUAGE not in tokens and not any(dot in text for dot in _DOTS):
        return None
    for token in tokens:
        # No digit fold here, because set codes carry digits and letters alike
        # ("2X2", "M21", "O7E").
        if token != _LANGUAGE and _SET_CODE.fullmatch(token):
            return token.lower()
    return None


def parse_corner(lines: list[TextLine]) -> CornerRead | None:
    """The collector number candidates and set code read in ``lines``, or None.

    Both must be found. Half a pair would pin nothing, because one collector
    number appears in hundreds of sets. Numbers read beside a rarity letter or
    set size come first, then bare digit lines, each in the order read.
    """
    numbers: list[_Number] = []
    set_code: str | None = None
    for ln in lines:
        if not _COPYRIGHT.search(ln.text):
            found = _number_on(ln.text)
            if found is not None:
                numbers.append(found)
        if set_code is None:
            set_code = _set_code_on(ln.text)
    if not numbers or set_code is None:
        return None
    # sorted is stable, so lines of one rank keep the order Vision read them.
    ranked = sorted(numbers, key=lambda n: not n.anchored)
    candidates = dict.fromkeys(form for n in ranked for form in n.forms())
    return CornerRead(collector_numbers=tuple(candidates)[:_MAX_NUMBERS], set_code=set_code)
