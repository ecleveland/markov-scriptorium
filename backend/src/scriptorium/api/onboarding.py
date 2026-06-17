"""Bulk-onboarding endpoints (VEG-280) — resolve import entries to printings.

The preview step for bulk imports: take raw entries (a name, optionally pinned
to a set/collector number) and report how each resolves against the local
catalog — matched / ambiguous / unmatched — without writing anything. The
caller disambiguates, then commits via ``POST /inventory/bulk``.
"""

from __future__ import annotations

from contextlib import closing
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

from scriptorium.db import connect
from scriptorium.onboarding import resolution

router = APIRouter(prefix="/onboarding", tags=["onboarding"])

# Mirror the bulk-inscribe cap so preview and commit accept the same batch size.
_MAX_ENTRIES = 10000


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


class ResolveRequest(BaseModel):
    entries: list[RawEntryIn] = Field(min_length=1, max_length=_MAX_ENTRIES)


@router.post("/resolve")
def resolve(payload: ResolveRequest) -> dict[str, Any]:
    """Resolve each entry against the catalog; returns per-entry status + a summary."""
    entries = [resolution.RawEntry(**entry.model_dump()) for entry in payload.entries]
    with closing(connect()) as conn:
        results = resolution.resolve_entries(conn, entries)
    return {"results": results, "summary": resolution.summarize(results)}
