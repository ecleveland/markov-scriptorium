"""Parse pasted MTG decklist text into resolvable entries (VEG-414).

A decklist is free-form text — one card per line, optionally prefixed by a
quantity and suffixed by a printing pin — interleaved with blank lines, comments,
and section headers (Deck / Sideboard / Commander…). This turns that text into
structured :class:`ParsedLine` entries the onboarding resolver understands, plus
a :class:`ParseProblem` for every non-blank line it cannot read. A line is never
silently dropped (ticket VEG-414): each card-bearing line becomes exactly one
entry or one problem.

Parsing is pure text and does not touch the catalog. A parsed line names a card
and *maybe* pins a printing (set code, collector number); turning that into a
concrete catalog printing is the resolver's job, so an unknown set code or an
unknown card name is a resolution outcome, not a parse error.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

# Board/section headers an export emits between groups of cards. Matched as a
# whole line (case-insensitively, a trailing ':' tolerated) so a card whose name
# merely starts with one of these words is still parsed as a card.
_SECTION_HEADERS = frozenset(
    {"deck", "sideboard", "commander", "companion", "maybeboard", "tokens"}
)

# A line that is only a quantity ("4", "4x", "12 x") — reported, not read as a
# card named "4".
_QUANTITY_ONLY_RE = re.compile(r"^\d+\s*[xX]?\s*$")
# A leading quantity: "4 ", "4x ", "4X ", "4 x " — the count, then the card body.
_QUANTITY_RE = re.compile(r"^(?P<quantity>\d+)\s*[xX]?\s+(?P<body>.+)$")
# A printing pin at the end of the body: "(SET)" then an optional collector no.
# The name is lazy so it stops at the parenthesised set code, and the collector
# number only exists alongside a set code (a bare trailing word stays in the
# name, e.g. the "Boss" of "Krenko, Mob Boss").
_PIN_RE = re.compile(r"^(?P<name>.+?)\s+\((?P<set_code>[^)]+)\)(?:\s+(?P<collector>\S+))?$")
# Foil/finish markers some exporters append ("*F*", "*E*"). Stripped, not stored:
# a decklist's finish is chosen per-import in the UI, not per line.
_FINISH_MARKER_RE = re.compile(r"\s*\*[A-Za-z]+\*")


@dataclass(frozen=True)
class ParsedLine:
    """One card line, shaped to become a resolver ``RawEntry``."""

    line_number: int
    name: str
    quantity: int = 1
    set_code: str | None = None
    collector_number: str | None = None


@dataclass(frozen=True)
class ParseProblem:
    """A non-blank line the parser could not read as a card."""

    line_number: int
    text: str
    reason: str


@dataclass(frozen=True)
class ParseResult:
    """Parsed entries plus a problem per unreadable card line."""

    entries: list[ParsedLine]
    problems: list[ParseProblem]


def parse_decklist(text: str) -> ParseResult:
    """Parse decklist ``text`` into card entries plus per-line problems.

    Blank lines, comment lines (a leading ``#`` or ``//``), and section headers
    are skipped silently; every other line yields exactly one entry or one
    problem, so ``len(entries) + len(problems)`` is the number of card-bearing
    lines.
    """
    entries: list[ParsedLine] = []
    problems: list[ParseProblem] = []
    for line_number, raw_line in enumerate(text.splitlines(), start=1):
        stripped = raw_line.strip()
        if not stripped or _is_comment(stripped) or _is_section_header(stripped):
            continue
        result = _parse_card_line(line_number, stripped)
        if isinstance(result, ParseProblem):
            problems.append(result)
        else:
            entries.append(result)
    return ParseResult(entries=entries, problems=problems)


def _is_comment(stripped: str) -> bool:
    """A line that is entirely a comment. A leading ``//`` is a comment marker;
    an inline ``//`` is left alone since it is the split-card separator."""
    return stripped.startswith("#") or stripped.startswith("//")


def _is_section_header(stripped: str) -> bool:
    return stripped.rstrip(":").strip().lower() in _SECTION_HEADERS


def _parse_card_line(line_number: int, text: str) -> ParsedLine | ParseProblem:
    # Drop finish markers and an inline '#' note before reading the card. '#'
    # never appears in a card name, so anything from it on is a comment; '//' is
    # left intact (split-card separator).
    body = _FINISH_MARKER_RE.sub("", text).split("#", 1)[0].strip()
    if not body:
        return ParseProblem(line_number, text, "no card name")
    if _QUANTITY_ONLY_RE.match(body):
        return ParseProblem(line_number, text, "quantity with no card name")

    quantity = 1
    quantity_match = _QUANTITY_RE.match(body)
    if quantity_match:
        quantity = int(quantity_match.group("quantity"))
        if quantity < 1:
            return ParseProblem(line_number, text, "quantity must be at least 1")
        body = quantity_match.group("body").strip()

    pin_match = _PIN_RE.match(body)
    if pin_match:
        name = pin_match.group("name").strip()
        # A whitespace-only "( )" carries no set code; emit None, not "", so the
        # resolver sees "no pin" rather than a filter on the empty string.
        set_code = pin_match.group("set_code").strip() or None
        collector = pin_match.group("collector")
        collector_number = collector.strip() if collector else None
    else:
        name, set_code, collector_number = body, None, None

    if not name:
        return ParseProblem(line_number, text, "missing card name")
    return ParsedLine(
        line_number=line_number,
        name=name,
        quantity=quantity,
        set_code=set_code,
        collector_number=collector_number,
    )
