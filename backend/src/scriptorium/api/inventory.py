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
from pydantic import BaseModel, Field, field_validator

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

    @field_validator("quantity", "condition")
    @classmethod
    def _not_explicit_null(cls, value: object) -> object:
        """Reject an explicit ``null`` for a NOT NULL column.

        Omitting the field leaves it unchanged (the validator doesn't run on the
        default); sending ``null`` would otherwise reach a NOT NULL column and
        surface as a raw database error instead of a clean 422.
        """
        if value is None:
            raise ValueError("must not be null; omit the field to leave it unchanged")
        return value


# Upper bound on a single bulk import; well above a large personal collection,
# low enough to bound one request's work.
_MAX_BULK_ROWS = 10000


class BulkInscribeRequest(BaseModel):
    """Body for inscribing many resolved lots at once (POST /inventory/bulk)."""

    rows: list[InventoryCreate] = Field(min_length=1, max_length=_MAX_BULK_ROWS)


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
        try:
            return inventory.create_lot(conn, **payload.model_dump())
        except sqlite3.IntegrityError as exc:
            # The printing was deleted between the existence check and the insert
            # (e.g. a concurrent bulk refresh); the FK is the authority.
            raise _not_in_catalog(payload.scryfall_id) from exc


@router.post("/bulk", status_code=201)
def inscribe_bulk(payload: BulkInscribeRequest) -> dict[str, Any]:
    """Inscribe many resolved lots in one atomic batch (bulk onboarding, VEG-280).

    Every row's printing is checked up front; if any is unknown the whole batch
    is rejected (422) with the offending rows, so an import never lands a partial
    collection. On success all rows commit in a single transaction.
    """
    rows = [row.model_dump() for row in payload.rows]
    with closing(connect()) as conn:
        present = inventory.existing_printing_ids(conn, [row["scryfall_id"] for row in rows])
        unknown = [
            {"index": index, "scryfall_id": row["scryfall_id"]}
            for index, row in enumerate(rows)
            if row["scryfall_id"] not in present
        ]
        if unknown:
            raise HTTPException(
                status_code=422,
                detail={
                    "message": "Some rows reference cards not in the catalog.",
                    "unknown": unknown,
                },
            )
        created = inventory.create_lots(conn, rows)
    return {"created": created, "count": len(created)}


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
        lot = inventory.update_lot(conn, lot_id, updates)
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
