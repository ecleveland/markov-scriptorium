"""Resolve raw bulk-import entries to concrete catalog printings (VEG-280).

A bulk import (decklist line, CSV row) names a card and, optionally, pins a
printing (set code, collector number). This service maps each raw entry to the
printings in the local catalog and classifies the outcome so the caller can act
on it — never silently dropping a row:

* ``matched``   — exactly one printing; ready to inscribe.
* ``ambiguous`` — several printings (e.g. a name reprinted across sets) with no
  pin narrowing it to one; the candidates are returned for the user to choose.
* ``unmatched`` — no printing in the catalog (typo, unknown card, a face name of
  a multi-faced card, etc.).

Resolution is read-only; writing the chosen printings is the bulk-inscribe
endpoint's job. Functions expect a connection from :func:`scriptorium.db.connect`.
"""

from __future__ import annotations

import sqlite3
from dataclasses import asdict, dataclass
from typing import Any, Literal

from scriptorium import catalog

ResolutionStatus = Literal["matched", "ambiguous", "unmatched"]


@dataclass(frozen=True)
class RawEntry:
    """One import line: a card name plus optional printing/acquisition details.

    ``scryfall_id`` and ``set_name`` exist for CSV imports (VEG-415): a Manabox /
    Archidekt row carries the exact Scryfall ID, while a Deckbox row names the
    edition rather than its code. A decklist line sets neither.
    """

    name: str
    set_code: str | None = None
    collector_number: str | None = None
    quantity: int = 1
    finish: str | None = None
    condition: str | None = None
    language: str | None = None
    scryfall_id: str | None = None
    set_name: str | None = None


def resolve_entry(conn: sqlite3.Connection, entry: RawEntry) -> dict[str, Any]:
    """Resolve one raw entry against the catalog; see module docs for statuses."""
    # A Scryfall ID names one exact printing. Honor it when it's in the local
    # catalog; a stale or foreign ID falls through to the name match so a row
    # whose name still resolves isn't lost.
    if entry.scryfall_id:
        card = catalog.get_card(conn, entry.scryfall_id.strip())
        if card is not None:
            # Drop card_faces so the match matches the name-path printing shape.
            printing = {key: value for key, value in card.items() if key != "card_faces"}
            return {
                "input": asdict(entry),
                "status": "matched",
                "match": printing,
                "candidates": [],
            }

    printings = catalog.printings_by_name(conn, entry.name)

    if entry.set_code:
        wanted = entry.set_code.strip().lower()
        printings = [p for p in printings if p["set_code"].lower() == wanted]
    elif entry.set_name:
        # Deckbox pins the edition by its display name, not a code.
        wanted_name = entry.set_name.strip().lower()
        printings = [p for p in printings if p["set_name"].lower() == wanted_name]
    if entry.collector_number:
        # Case-insensitive like set_code: collector numbers can carry letters
        # (e.g. "123a"), and an import shouldn't miss on a case mismatch.
        wanted_cn = entry.collector_number.strip().lower()
        printings = [p for p in printings if p["collector_number"].lower() == wanted_cn]

    if not printings:
        status: ResolutionStatus = "unmatched"
        match: dict[str, Any] | None = None
        candidates: list[dict[str, Any]] = []
    elif len(printings) == 1:
        status, match, candidates = "matched", printings[0], []
    else:
        status, match, candidates = "ambiguous", None, printings

    return {
        "input": asdict(entry),
        "status": status,
        "match": match,
        "candidates": candidates,
    }


def resolve_entries(conn: sqlite3.Connection, entries: list[RawEntry]) -> list[dict[str, Any]]:
    """Resolve a batch of entries, preserving order."""
    return [resolve_entry(conn, entry) for entry in entries]


def summarize(results: list[dict[str, Any]]) -> dict[str, int]:
    """Count results by status — a quick headline for the import preview."""
    summary = {"matched": 0, "ambiguous": 0, "unmatched": 0}
    for result in results:
        summary[result["status"]] += 1
    return summary
