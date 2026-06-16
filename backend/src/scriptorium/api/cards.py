"""Card lookup endpoints (VEG-215) — read the local catalog, never live Scryfall.

Exposes the Scryfall data loaded by the bulk pipeline: a by-ID detail lookup,
name search, and type-ahead autocomplete. All reads go through
:mod:`scriptorium.catalog` against the local SQLite catalog.
"""

from __future__ import annotations

from contextlib import closing
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from scriptorium import catalog
from scriptorium.db import connect

router = APIRouter(prefix="/cards", tags=["cards"])


# /search and /autocomplete are declared before the /{scryfall_id} catch-all so
# the path parameter doesn't swallow them.
@router.get("/search")
def search_cards(
    q: str = Query(..., min_length=1, description="Name to search for (substring/fuzzy)."),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    """Search the catalog by card name; paginated, with a total match count."""
    with closing(connect()) as conn:
        results, total = catalog.search_cards(conn, q, limit=limit, offset=offset)
    return {"results": results, "total": total, "limit": limit, "offset": offset}


@router.get("/autocomplete")
def autocomplete(
    q: str = Query(..., min_length=1, description="Prefix/substring of a card name."),
    limit: int = Query(10, ge=1, le=50),
) -> dict[str, Any]:
    """Return distinct card names matching ``q`` for type-ahead entry."""
    with closing(connect()) as conn:
        names = catalog.autocomplete_names(conn, q, limit=limit)
    return {"names": names}


@router.get("/{scryfall_id}")
def get_card(scryfall_id: str) -> dict[str, Any]:
    """Look up a single printing by its Scryfall ID, with faces."""
    with closing(connect()) as conn:
        card = catalog.get_card(conn, scryfall_id)
    if card is None:
        raise HTTPException(
            status_code=404,
            detail=f"No card with Scryfall ID {scryfall_id!r} resides in the catalog.",
        )
    return card
