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


def detect_format(header: list[str]) -> CsvFormat | None:
    """Return the unique source whose signature columns are all present, else None."""
    columns = frozenset(column.strip().lower() for column in header)
    matches = [fmt for fmt, spec in _SPECS.items() if spec.signature <= columns]
    return matches[0] if len(matches) == 1 else None


def parse_csv(text: str, declared_format: CsvFormat | None = None) -> CsvParseResult:
    """Parse CSV ``text`` into normalized rows + per-row problems.

    The source is taken from ``declared_format`` when given (a user override),
    else detected from the header. Each data row yields exactly one entry or one
    problem, so nothing is dropped. Raises :class:`UnknownCsvFormat` when no
    format is declared and the header matches none.
    """
    reader = csv.DictReader(io.StringIO(text))
    header = list(reader.fieldnames or [])
    fmt = declared_format or detect_format(header)
    if fmt is None:
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


def _normalize_row(row_number: int, raw: dict[str, str | None], spec: _Spec) -> CsvRow | CsvProblem:
    text = _raw_text(raw)

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

    raw_finish = raw.get(spec.finish)
    finish = _FINISH.get((raw_finish or "").strip().lower())
    if finish is None:
        return CsvProblem(row_number, text, f"unrecognized finish {(raw_finish or '').strip()!r}")

    raw_condition = raw.get(spec.condition)
    condition = _CONDITION.get((raw_condition or "").strip().lower())
    if condition is None:
        return CsvProblem(
            row_number, text, f"unrecognized condition {(raw_condition or '').strip()!r}"
        )

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


def _normalize_language(value: str | None) -> str | None:
    """Map a language display name to its short code; pass unknowns through."""
    cleaned = _clean(value)
    if cleaned is None:
        return None
    return _LANGUAGE.get(cleaned.lower(), cleaned)


def _clean(value: str | None) -> str | None:
    """Strip a cell; an empty or missing cell becomes None."""
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


def _raw_text(raw: dict[str, str | None]) -> str:
    """Re-join a row's cells for display in a problem report."""
    return ",".join(value for value in raw.values() if value)
