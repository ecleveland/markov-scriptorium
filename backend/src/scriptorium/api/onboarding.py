"""Bulk-onboarding endpoints (VEG-280) — resolve import entries to printings.

The preview step for bulk imports: take raw entries (a name, optionally pinned
to a set/collector number) and report how each resolves against the local
catalog — matched / ambiguous / unmatched — without writing anything. The
caller disambiguates, then commits via ``POST /inventory/bulk``.
"""

from __future__ import annotations

from contextlib import closing
from dataclasses import asdict
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from scriptorium import inventory
from scriptorium.db import connect
from scriptorium.onboarding import csv_import, decklist, resolution

router = APIRouter(prefix="/onboarding", tags=["onboarding"])

# Upper bound on a pasted decklist's size. A full Cube list is a few thousand
# short lines; a megabyte is comfortably above any real paste and caps the work
# a single request can ask the parser to do.
PARSE_MAX_CHARS = 1_000_000


class RawEntryIn(BaseModel):
    """One import line to resolve. Only ``name`` is required; the rest pin the
    printing or carry acquisition details echoed back for the preview."""

    name: str = Field(min_length=1)
    set_code: str | None = None
    collector_number: str | None = None
    quantity: int = Field(default=1, gt=0)
    finish: str | None = None
    condition: str | None = None
    language: str | None = None
    # CSV imports (VEG-415): an exact printing pin, or an edition display name.
    scryfall_id: str | None = None
    set_name: str | None = None


class ParseRequest(BaseModel):
    """Body for parsing raw decklist text (POST /onboarding/parse)."""

    text: str = Field(min_length=1, max_length=PARSE_MAX_CHARS)


@router.post("/parse")
def parse(payload: ParseRequest) -> dict[str, Any]:
    """Parse decklist text into entries + per-line problems; writes nothing.

    The format-specific step of bulk onboarding: turn pasted text into structured
    entries the catalog-aware ``/onboarding/resolve`` step can consume, reporting
    every unreadable line rather than dropping it.
    """
    result = decklist.parse_decklist(payload.text)
    return {
        "entries": [asdict(entry) for entry in result.entries],
        "problems": [asdict(problem) for problem in result.problems],
    }


class ParseCsvRequest(BaseModel):
    """Body for parsing a collection CSV (POST /onboarding/parse-csv).

    ``format`` overrides header auto-detection when the user picks a source
    explicitly (a hand-edited export, an unrecognized header)."""

    text: str = Field(min_length=1, max_length=PARSE_MAX_CHARS)
    format: csv_import.CsvFormat | None = None


@router.post("/parse-csv")
def parse_csv(payload: ParseCsvRequest) -> dict[str, Any]:
    """Parse a Manabox / Deckbox / Archidekt CSV into entries + per-row problems.

    Catalog-free, like ``/parse``: the source set/ID pins resolve to printings in
    the ``/resolve`` step. An unrecognized header (with no ``format`` override) is
    a 422 carrying the observed headers and the supported sources so the UI can
    prompt for an explicit choice.
    """
    try:
        result = csv_import.parse_csv(payload.text, payload.format)
    except csv_import.UnknownCsvFormat as exc:
        raise HTTPException(
            status_code=422,
            detail={
                "message": "Could not recognize the CSV format. Choose a source explicitly.",
                "headers": exc.headers,
                "supported": list(csv_import.SUPPORTED_FORMATS),
            },
        ) from exc
    return {
        "format": result.format,
        "entries": [asdict(entry) for entry in result.entries],
        "problems": [asdict(problem) for problem in result.problems],
    }


class ResolveRequest(BaseModel):
    # Mirror the bulk-inscribe cap so preview and commit accept the same batch.
    entries: list[RawEntryIn] = Field(min_length=1, max_length=inventory.MAX_BULK_ROWS)


@router.post("/resolve")
def resolve(payload: ResolveRequest) -> dict[str, Any]:
    """Resolve each entry against the catalog; returns per-entry status + a summary."""
    entries = [resolution.RawEntry(**entry.model_dump()) for entry in payload.entries]
    with closing(connect()) as conn:
        results = resolution.resolve_entries(conn, entries)
    return {"results": results, "summary": resolution.summarize(results)}
