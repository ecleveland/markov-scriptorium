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
# because Vision misread it as a digit at 14 px, so it is never relied on. A
# suffix can come back in either case and is lowercased, as the catalog has it.
_NUMBER_LINE = re.compile(r"\s*([A-Z])?\s*(\d{1,4})([A-Za-z★]?)\s*(/\s*\d{1,4})?\s*")
_NUMBER_TOKEN = re.compile(r"(\d{1,4})([A-Za-z★]?)|(\d{1,4})/\d{1,4}")
# A rarity letter glued to the number, as in "C0002".
_RARITY_GLUED = re.compile(r"[A-Z](\d{1,4})")
# A pin needs one lookup per candidate, and past three the guesses are noise.
_MAX_NUMBERS = 3
# Letters Vision reads in place of digits. Applied only to a token that
# already has a digit and matches nothing as read, so a word such as "Randy"
# and a suffix such as the S in "63S" are left alone.
_DIGIT_FOLDS = str.maketrans({"O": "0", "o": "0", "l": "1", "I": "1", "S": "5"})

# No set code is all digits, so a code needs a letter. That keeps the number
# from being taken as the set when Vision runs both lines into one.
_SET_CODE = re.compile(r"(?=[A-Z0-9]*[A-Z])[A-Z0-9]{3,6}")
# The language code and the dot between it and the set code mark the set
# line, so a three-letter word elsewhere in the corner is not taken for a set.
_LANGUAGE = "EN"
_DOTS = "•·"
_SET_LINE_TOKENS = re.compile(rf"[{_DOTS}]|[^\s{_DOTS}]+")
# The collector number and set line start on the card's left half. The power
# and toughness box and the copyright line start right of its middle, so a
# line starting at or right of the frame's middle is never read. The left
# edge, not the centre, because the set line runs on into the artist's name
# and passes the middle on a card held right of the guide.
_LEFT_OF = 0.5
# The copyright line ("™ & © 2024 Wizards of the Coast") sits in the same band
# on the right, and its year looks like a collector number. Its place on the
# right is the first guard and this the second.
_COPYRIGHT = re.compile(r"[©™]|\(TM\)|\bwizards\b", re.IGNORECASE)


@dataclass(frozen=True, slots=True)
class CornerRead:
    """Collector number candidates and the set code the corner showed."""

    # Up to _MAX_NUMBERS, best first and without repeats. Every number comes
    # first with its leading zeros stripped, because Scryfall stores "2"
    # where the card prints "0002". The numbers as read follow, for the few
    # the catalog stores padded. A letter suffix stays, lowercased by the
    # parser, because the catalog stores it lowercase.
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

    @property
    def stripped(self) -> str:
        return self.digits.lstrip("0") + self.suffix

    @property
    def as_read(self) -> str:
        return self.digits + self.suffix


def _number(digits: str, suffix: str = "", *, anchored: bool = False) -> _Number | None:
    # An all-zero number is no card's collector number.
    if not digits.strip("0"):
        return None
    return _Number(digits, suffix.lower(), anchored)


def _numbers(digits: str, suffix: str, *, anchored: bool, fold: bool) -> list[_Number]:
    """The number with its suffix, then with a capital suffix folded to a digit.

    A trailing capital the digit map knows, as in "012S", is a suffix more
    often than a misread 5, so the suffix reading comes first.
    """
    found = _number(digits, suffix, anchored=anchored)
    if found is None:
        return []
    numbers = [found]
    if fold and suffix.isupper() and suffix.translate(_DIGIT_FOLDS).isdigit():
        folded = _number(digits + suffix.translate(_DIGIT_FOLDS), anchored=anchored)
        if folded is not None and len(folded.digits) <= 4:
            numbers.append(folded)
    return numbers


def _number_in(token: str, *, fold: bool, glued_rarity: bool) -> list[_Number]:
    match = _NUMBER_TOKEN.fullmatch(token)
    if match is None and glued_rarity:
        glued = _RARITY_GLUED.fullmatch(token)
        if glued is not None:
            return _numbers(glued.group(1), "", anchored=True, fold=False)
    if match is None and fold and any(ch.isdigit() for ch in token):
        match = _NUMBER_TOKEN.fullmatch(token.translate(_DIGIT_FOLDS))
    if match is None:
        return []
    if match.group(1) is not None:
        return _numbers(match.group(1), match.group(2), anchored=False, fold=fold)
    return _numbers(match.group(3), "", anchored=True, fold=False)


def _is_rarity(token: str) -> bool:
    return len(token) == 1 and token.isupper()


def _number_on(text: str, *, set_line: bool) -> list[_Number]:
    """The collector number on one line, best reading first, if it has one."""
    # The whole line first and as read, so a rarity letter the digit map would
    # turn into a digit, such as the S in "S0123", is still taken as a letter.
    whole = _NUMBER_LINE.fullmatch(text)
    if whole is not None:
        anchored = whole.group(1) is not None or whole.group(4) is not None
        return _numbers(whole.group(2), whole.group(3), anchored=anchored, fold=not set_line)
    tokens = text.split()
    best: list[_Number] = []
    for i, token in enumerate(tokens):
        # The set line's other tokens are artists and set symbols. Folded,
        # "SO1" there would read as a number. A capital glued to the number is
        # the rarity letter only when the rarity has no token of its own, so
        # in "C I023" the I is a misread 1.
        found = _number_in(
            token,
            fold=not set_line,
            glued_rarity=i == 0 or not _is_rarity(tokens[i - 1]),
        )
        # "2 0002" is the rarity letter misread as a digit, so the longest
        # run is the number. The first wins a tie.
        if found and (not best or len(found[0].digits) > len(best[0].digits)):
            best = found
    # A number read beside another token sat beside its rarity letter, however
    # misread. Alone it only counts as anchored with its set size.
    if len(tokens) > 1 or "/" in text:
        best = [_Number(n.digits, n.suffix, anchored=True) for n in best]
    return best


def _split_set_code(text: str) -> tuple[str | None, str]:
    """The set code on a line and the line without it.

    A line is the set line when it carries the language code or a dot. The
    token right before the first of them is the set code when it fits,
    because that is where the card prints it. Otherwise the first token that
    fits is. No digit fold here, because set codes carry digits and letters
    alike ("2X2", "M21", "O7E").
    """
    tokens = _SET_LINE_TOKENS.findall(text)
    marks = [i for i, token in enumerate(tokens) if token == _LANGUAGE or token in _DOTS]
    if not marks:
        return None, text
    before = marks[0] - 1
    fits = [
        i for i, token in enumerate(tokens) if token != _LANGUAGE and _SET_CODE.fullmatch(token)
    ]
    if not fits:
        return None, text
    chosen = before if before in fits else fits[0]
    rest = " ".join(token for i, token in enumerate(tokens) if i != chosen)
    return tokens[chosen].lower(), rest


def _is_set_line(text: str) -> bool:
    return any(dot in text for dot in _DOTS) or _LANGUAGE in _SET_LINE_TOKENS.findall(text)


def parse_corner(lines: list[TextLine]) -> CornerRead | None:
    """The collector number candidates and set code read in ``lines``, or None.

    Both must be found. Half a pair would pin nothing, because one collector
    number appears in hundreds of sets. Lines are read top to bottom and left
    to right by where they sit, because Vision does not promise an order.
    Numbers read beside a rarity letter or set size rank first, then bare
    digit lines. Every number with its zeros stripped comes before any number
    as read.
    """
    numbers: list[_Number] = []
    set_code: str | None = None
    for ln in sorted(lines, key=lambda ln: (ln.box.y, ln.box.x)):
        if ln.box.x >= _LEFT_OF:
            continue
        code, rest = _split_set_code(ln.text)
        if set_code is None:
            set_code = code
        if not _COPYRIGHT.search(rest):
            numbers.extend(_number_on(rest, set_line=_is_set_line(rest)))
    if not numbers or set_code is None:
        return None
    # sorted is stable, so lines of one rank keep their place on the card.
    ranked = sorted(numbers, key=lambda n: not n.anchored)
    forms = [n.stripped for n in ranked] + [n.as_read for n in ranked]
    candidates = tuple(dict.fromkeys(forms))[:_MAX_NUMBERS]
    return CornerRead(collector_numbers=candidates, set_code=set_code)
