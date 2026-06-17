"""Inventory CRUD endpoints (VEG-218) — manage the owned collection.

Inscribe a card into the catalog, list and inspect owned lots, amend a lot, and
remove one. All reads and writes go through :mod:`scriptorium.inventory` against
the local SQLite catalog. Request bodies are validated by the Pydantic models
below; the ``finish``/``condition`` enums mirror the schema's CHECK constraints
(migration 0005) so a bad value is a 422, never a database error.
"""

from __future__ import annotations

import sqlite3
from contextlib import closing
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import BaseModel, Field

from scriptorium import inventory
from scriptorium.db import connect

router = APIRouter(prefix="/inventory", tags=["inventory"])

Finish = Literal["nonfoil", "foil", "etched"]
Condition = Literal["NM", "LP", "MP", "HP", "DMG"]


class InventoryCreate(BaseModel):
    """Body for inscribing a card (POST /inventory)."""

    scryfall_id: str = Field(min_length=1)
    quantity: int = Field(default=1, gt=0)
    finish: Finish = "nonfoil"
    condition: Condition = "NM"
    language: str = Field(default="en", min_length=1)
    location: str | None = None
    acquired_at: str | None = None
    price_paid: str | None = None
    notes: str | None = None
    tags: list[str] | None = None


class InventoryUpdate(BaseModel):
    """Body for amending a lot (PATCH /inventory/{id}); all fields optional.

    Only the four mutable fields per VEG-218. ``location``/``notes`` may be set to
    ``null`` to clear them; ``exclude_unset`` distinguishes "clear" from "leave".
    """

    quantity: int | None = Field(default=None, gt=0)
    condition: Condition | None = None
    location: str | None = None
    notes: str | None = None


def _not_in_catalog(scryfall_id: str) -> HTTPException:
    return HTTPException(
        status_code=404,
        detail=f"No card with Scryfall ID {scryfall_id!r} resides in the catalog.",
    )


def _lot_not_found(lot_id: int) -> HTTPException:
    return HTTPException(status_code=404, detail=f"No inventory lot with id {lot_id}.")


@router.post("", status_code=201)
def inscribe(payload: InventoryCreate) -> dict[str, Any]:
    """Inscribe a card into the collection as a new acquisition lot."""
    with closing(connect()) as conn:
        if not inventory.printing_exists(conn, payload.scryfall_id):
            raise _not_in_catalog(payload.scryfall_id)
        return inventory.create_lot(conn, **payload.model_dump())


@router.get("")
def list_inventory(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    """List owned lots, newest first; paginated, with a total count."""
    with closing(connect()) as conn:
        results, total = inventory.list_lots(conn, limit=limit, offset=offset)
    return {"results": results, "total": total, "limit": limit, "offset": offset}


# /card/{scryfall_id} is declared before /{lot_id} so the literal segment wins
# and a Scryfall ID isn't parsed as an integer lot id.
@router.get("/card/{scryfall_id}")
def owned_copies(scryfall_id: str) -> dict[str, Any]:
    """All owned copies of one printing, with a per-folio quantity rollup."""
    with closing(connect()) as conn:
        if not inventory.printing_exists(conn, scryfall_id):
            raise _not_in_catalog(scryfall_id)
        return inventory.owned_for_printing(conn, scryfall_id)


@router.get("/{lot_id}")
def get_inventory(lot_id: int) -> dict[str, Any]:
    """Inspect a single inventory lot."""
    with closing(connect()) as conn:
        lot = inventory.get_lot(conn, lot_id)
    if lot is None:
        raise _lot_not_found(lot_id)
    return lot


@router.patch("/{lot_id}")
def update_inventory(lot_id: int, payload: InventoryUpdate) -> dict[str, Any]:
    """Amend a lot's quantity, condition, location, or notes."""
    updates = payload.model_dump(exclude_unset=True)
    with closing(connect()) as conn:
        try:
            lot = inventory.update_lot(conn, lot_id, updates)
        except sqlite3.IntegrityError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
    if lot is None:
        raise _lot_not_found(lot_id)
    return lot


@router.delete("/{lot_id}", status_code=204)
def remove_inventory(lot_id: int) -> Response:
    """Remove a lot from the collection."""
    with closing(connect()) as conn:
        deleted = inventory.delete_lot(conn, lot_id)
    if not deleted:
        raise _lot_not_found(lot_id)
    return Response(status_code=204)
