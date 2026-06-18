"""Parse collection CSV exports into resolvable rows (VEG-415).

Manabox, Deckbox, and Archidekt each export a different column layout and a
different finish/condition vocabulary. This detects the source from the header
row, maps its columns into the shared resolver shape, and normalizes finish and
condition into the catalog's enums — emitting a per-row problem (never dropping
a row) when a value can't be read.

Pure text, like the decklist parser: it does not touch the catalog. The set / ID
pins it produces are turned into concrete printings by the resolution service —
a Manabox/Archidekt row pins the exact Scryfall ID, a Deckbox row names the
edition (``set_name``) since it carries no set code.
"""

from __future__ import annotations

import csv
import io
from dataclasses import dataclass
from typing import Literal

CsvFormat = Literal["manabox", "deckbox", "archidekt"]

SUPPORTED_FORMATS: tuple[CsvFormat, ...] = ("manabox", "deckbox", "archidekt")

# DictReader stashes a row's surplus cells (more fields than headers) under this
# key as a list, so a ragged row is reported rather than crashing the parse.
_EXTRA = "__extra__"


@dataclass(frozen=True)
class CsvRow:
    """One normalized CSV row, shaped to become a resolver ``RawEntry``."""

    row_number: int
    name: str
    quantity: int = 1
    set_code: str | None = None
    set_name: str | None = None
    collector_number: str | None = None
    scryfall_id: str | None = None
    finish: str | None = None
    condition: str | None = None
    language: str | None = None


@dataclass(frozen=True)
class CsvProblem:
    """A data row the parser could not read into a normalized row."""

    row_number: int
    text: str
    reason: str


@dataclass(frozen=True)
class CsvParseResult:
    """The detected source format, normalized rows, and per-row problems."""

    format: CsvFormat
    entries: list[CsvRow]
    problems: list[CsvProblem]


class UnknownCsvFormat(Exception):
    """Raised when the header row matches no supported source (and none was declared)."""

    def __init__(self, headers: list[str]) -> None:
        self.headers = headers
        super().__init__("Could not recognize the CSV format from its header row.")


@dataclass(frozen=True)
class _Spec:
    """Where a source keeps each field, and the header columns that identify it."""

    quantity: str
    collector: str | None
    set_code: str | None
    set_name: str | None
    scryfall_id: str | None
    finish: str
    condition: str
    language: str | None
    # Distinctive header columns (lowercased) that uniquely mark this source.
    signature: frozenset[str]
    name: str = "Name"


_SPECS: dict[CsvFormat, _Spec] = {
    "manabox": _Spec(
        quantity="Quantity",
        collector="Collector number",
        set_code="Set code",
        set_name="Set name",
        scryfall_id="Scryfall ID",
        finish="Foil",
        condition="Condition",
        language="Language",
        signature=frozenset({"scryfall id", "set code", "foil"}),
    ),
    "archidekt": _Spec(
        quantity="Quantity",
        collector="Collector Number",
        set_code="Edition Code",
        set_name="Edition Name",
        scryfall_id="Scryfall ID",
        finish="Finish",
        condition="Condition",
        language="Language",
        signature=frozenset({"scryfall id", "edition code", "finish"}),
    ),
    "deckbox": _Spec(
        quantity="Count",
        collector="Card Number",
        set_code=None,
        set_name="Edition",
        scryfall_id=None,
        finish="Foil",
        condition="Condition",
        language="Language",
        signature=frozenset({"count", "edition", "card number"}),
    ),
}

# Source finish vocab → the catalog's finish enum. A blank Foil column (Deckbox /
# Manabox non-foils) means non-foil; that's a real mapping, not a missing value.
_FINISH: dict[str, str] = {
    "": "nonfoil",
    "normal": "nonfoil",
    "nonfoil": "nonfoil",
    "non-foil": "nonfoil",
    "foil": "foil",
    "etched": "etched",
}

# Source condition vocab → the catalog's condition enum, merged across all three
# sources (short codes, Manabox snake_case, Deckbox display names). A blank is
# intentionally absent: an unstated condition is reported, not guessed as NM.
_CONDITION: dict[str, str] = {
    "nm": "NM",
    "near mint": "NM",
    "near_mint": "NM",
    "mint": "NM",
    "lp": "LP",
    "lightly played": "LP",
    "lightly_played": "LP",
    "good (lightly played)": "LP",
    "mp": "MP",
    "played": "MP",
    "moderately played": "MP",
    "moderately_played": "MP",
    "hp": "HP",
    "heavily played": "HP",
    "heavily_played": "HP",
    "dmg": "DMG",
    "damaged": "DMG",
    "poor": "DMG",
}

# Common language display names → Scryfall short codes. Unknown values pass
# through unchanged (language is informational; the catalog is English-only).
_LANGUAGE: dict[str, str] = {
    "english": "en",
    "japanese": "ja",
    "german": "de",
    "french": "fr",
    "italian": "it",
    "spanish": "es",
    "portuguese": "pt",
    "russian": "ru",
    "korean": "ko",
    "chinese simplified": "zhs",
    "chinese traditional": "zht",
}


def _columns(header: list[str]) -> frozenset[str]:
    """The header's column names, trimmed and lowercased, for signature matching."""
    return frozenset(column.strip().lower() for column in header)


def detect_format(header: list[str]) -> CsvFormat | None:
    """Return the unique source whose signature columns are all present, else None."""
    columns = _columns(header)
    matches = [fmt for fmt, spec in _SPECS.items() if spec.signature <= columns]
    return matches[0] if len(matches) == 1 else None


def parse_csv(text: str, declared_format: CsvFormat | None = None) -> CsvParseResult:
    """Parse CSV ``text`` into normalized rows + per-row problems.

    The source is taken from ``declared_format`` when given (a user override),
    else detected from the header. Each data row yields exactly one entry or one
    problem, so nothing is dropped. Raises :class:`UnknownCsvFormat` when no
    format is declared and the header matches none.
    """
    # restkey/restval keep ragged rows addressable: surplus cells land under
    # _EXTRA (a list) instead of the default None key, and short rows fill with
    # "" instead of None — so a malformed row becomes a problem, never a crash.
    reader = csv.DictReader(io.StringIO(text), restkey=_EXTRA, restval="")
    header = list(reader.fieldnames or [])
    fmt = declared_format or detect_format(header)
    if fmt is None:
        raise UnknownCsvFormat(header)
    # A declared override must still actually be that format; otherwise its
    # columns are absent and every row would mis-map (e.g. a missing Foil column
    # silently reads as non-foil). Verify the signature before trusting it.
    if declared_format is not None and not _SPECS[declared_format].signature <= _columns(header):
        raise UnknownCsvFormat(header)
    spec = _SPECS[fmt]

    entries: list[CsvRow] = []
    problems: list[CsvProblem] = []
    # DictReader skips wholly blank lines; number the rows it does yield.
    for row_number, raw in enumerate(reader, start=1):
        outcome = _normalize_row(row_number, raw, spec)
        if isinstance(outcome, CsvProblem):
            problems.append(outcome)
        else:
            entries.append(outcome)
    return CsvParseResult(format=fmt, entries=entries, problems=problems)


def _normalize_row(
    row_number: int, raw: dict[str, str | list[str] | None], spec: _Spec
) -> CsvRow | CsvProblem:
    text = _raw_text(raw)

    if raw.get(_EXTRA):
        return CsvProblem(row_number, text, "row has more columns than the header")

    name = _clean(raw.get(spec.name))
    if not name:
        return CsvProblem(row_number, text, "missing card name")

    quantity_text = _clean(raw.get(spec.quantity)) or ""
    try:
        quantity = int(quantity_text)
    except ValueError:
        return CsvProblem(row_number, text, f"invalid quantity {quantity_text!r}")
    if quantity < 1:
        return CsvProblem(row_number, text, "quantity must be at least 1")

    raw_finish = _cell(raw.get(spec.finish)) or ""
    finish = _FINISH.get(raw_finish.strip().lower())
    if finish is None:
        return CsvProblem(row_number, text, f"unrecognized finish {raw_finish.strip()!r}")

    raw_condition = _cell(raw.get(spec.condition)) or ""
    condition = _CONDITION.get(raw_condition.strip().lower())
    if condition is None:
        return CsvProblem(row_number, text, f"unrecognized condition {raw_condition.strip()!r}")

    return CsvRow(
        row_number=row_number,
        name=name,
        quantity=quantity,
        set_code=_clean(raw.get(spec.set_code)) if spec.set_code else None,
        set_name=_clean(raw.get(spec.set_name)) if spec.set_name else None,
        collector_number=_clean(raw.get(spec.collector)) if spec.collector else None,
        scryfall_id=_clean(raw.get(spec.scryfall_id)) if spec.scryfall_id else None,
        finish=finish,
        condition=condition,
        language=_normalize_language(raw.get(spec.language)) if spec.language else None,
    )


def _normalize_language(value: str | list[str] | None) -> str | None:
    """Map a language display name to its short code; pass unknowns through."""
    cleaned = _clean(value)
    if cleaned is None:
        return None
    return _LANGUAGE.get(cleaned.lower(), cleaned)


def _cell(value: str | list[str] | None) -> str | None:
    """One cell value; the surplus-columns list (under _EXTRA) collapses to None."""
    return value if isinstance(value, str) else None


def _clean(value: str | list[str] | None) -> str | None:
    """Strip a cell; an empty or missing cell becomes None."""
    cell = _cell(value)
    if cell is None:
        return None
    return cell.strip() or None


def _raw_text(raw: dict[str, str | list[str] | None]) -> str:
    """Re-join a row's cells for display in a problem report (surplus cells too)."""
    parts: list[str] = []
    for value in raw.values():
        if isinstance(value, list):
            parts.extend(item for item in value if item)
        elif value:
            parts.append(value)
    return ",".join(parts)
