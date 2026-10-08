"""Tome endpoints (VEG-223): bind, read, amend, and unbind decks and their slots.

All reads and writes go through :mod:`scriptorium.decks` against the local
SQLite catalog. The Pydantic models below validate every body, and their
``status``, ``finish``, and ``board`` literals mirror the schema's CHECK
constraints (migration 0006), so bad input is a 422 and never a database error.

Slot conflicts the data layer detects (a second commander copy, a swap onto a
slot the Tome already holds) answer 409. An IntegrityError that still gets
through, for example when a printing vanishes between the check and the write,
maps to 404 or 409 and never to a 500.
"""

from __future__ import annotations

import re
import sqlite3
from contextlib import closing
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field, field_validator

from scriptorium import decks
from scriptorium.db import connect
from scriptorium.inventory import printing_exists

router = APIRouter(prefix="/decks", tags=["decks"])

Status = Literal["in_progress", "active", "playtest", "shelved"]
Finish = Literal["nonfoil", "foil", "etched"]
Board = Literal["main", "sideboard", "commander", "companion", "maybeboard"]

# A lowercase Scryfall legalities key, or 'cube' / 'brew'. No fixed list, because
# Scryfall adds formats.
_FORMAT_PATTERN = re.compile(r"^[a-z0-9_]+$")


def _clean_name(value: str | None) -> str:
    """Trim all whitespace from a Tome name; reject null and blank."""
    if value is None:
        raise ValueError("must not be null; omit the field to leave it unchanged")
    name = value.strip()
    if not name:
        raise ValueError("must not be blank")
    return name


def _clean_format(value: str | None) -> str | None:
    """Trim and lowercase a format; it must then be a lowercase key or null."""
    if value is None:
        return None
    fmt = value.strip().lower()
    if not _FORMAT_PATTERN.match(fmt):
        raise ValueError("must be a lowercase format key such as 'commander' or 'modern'")
    return fmt


def _clean_scryfall_id(value: str | None) -> str:
    """Trim whitespace from a Scryfall ID; reject null and blank."""
    if value is None:
        raise ValueError("must not be null; omit the field to leave it unchanged")
    scryfall_id = value.strip()
    if not scryfall_id:
        raise ValueError("must not be blank")
    return scryfall_id


def _reject_null(value: object) -> object:
    """Reject an explicit ``null`` for a NOT NULL column.

    Omitting the field leaves it unchanged (the validator doesn't run on the
    default). Sending ``null`` would otherwise reach a NOT NULL column and
    surface as a database error instead of a clean 422.
    """
    if value is None:
        raise ValueError("must not be null; omit the field to leave it unchanged")
    return value


class DeckCreate(BaseModel):
    """Body for binding a Tome (POST /decks)."""

    name: str
    format: str | None = None
    status: Status = "in_progress"
    claims_cards: bool = True
    notes: str | None = None
    changelog: str | None = None

    _name = field_validator("name")(_clean_name)
    _format = field_validator("format")(_clean_format)


class DeckUpdate(BaseModel):
    """Body for amending a Tome (PATCH /decks/{deck_id}); all fields optional.

    ``format``, ``notes``, and ``changelog`` may be set to ``null`` to clear
    them. ``name``, ``status``, and ``claims_cards`` may not.
    """

    name: str | None = None
    format: str | None = None
    status: Status | None = None
    claims_cards: bool | None = None
    notes: str | None = None
    changelog: str | None = None

    _name = field_validator("name")(_clean_name)
    _format = field_validator("format")(_clean_format)
    _not_null = field_validator("status", "claims_cards")(_reject_null)


class SlotCreate(BaseModel):
    """Body for adding copies of a printing to a Tome (POST /decks/{deck_id}/cards)."""

    scryfall_id: str = Field(min_length=1)
    finish: Finish = "nonfoil"
    board: Board = "main"
    quantity: int = Field(default=1, gt=0)

    _scryfall_id = field_validator("scryfall_id")(_clean_scryfall_id)


class SlotUpdate(BaseModel):
    """Body for amending a slot (PATCH /decks/{deck_id}/cards/{slot_id}).

    Changing ``scryfall_id`` or ``finish`` is how the editor swaps to a
    printing the user owns. Every field is NOT NULL in the schema, so none may
    be sent as ``null``.
    """

    quantity: int | None = Field(default=None, gt=0)
    scryfall_id: str | None = Field(default=None, min_length=1)
    finish: Finish | None = None
    board: Board | None = None

    _scryfall_id = field_validator("scryfall_id")(_clean_scryfall_id)
    _not_null = field_validator("quantity", "finish", "board")(_reject_null)


def _deck_not_found(deck_id: int) -> HTTPException:
    return HTTPException(status_code=404, detail=f"No Tome with id {deck_id}.")


def _slot_not_found(deck_id: int, slot_id: int) -> HTTPException:
    return HTTPException(status_code=404, detail=f"Tome {deck_id} has no slot with id {slot_id}.")


def _not_in_catalog(scryfall_id: str) -> HTTPException:
    return HTTPException(
        status_code=404,
        detail=f"No card with Scryfall ID {scryfall_id!r} resides in the catalog.",
    )


def _conflict(message: str) -> HTTPException:
    return HTTPException(status_code=409, detail=message)


# --- Tomes --------------------------------------------------------------------


@router.post("", status_code=201)
def bind_tome(payload: DeckCreate) -> dict[str, Any]:
    """Bind a new Tome."""
    with closing(connect()) as conn:
        return decks.create_deck(conn, **payload.model_dump())


@router.get("")
def list_tomes() -> list[dict[str, Any]]:
    """Every Tome, newest first, each with its ``card_count`` (maybeboard excluded)."""
    with closing(connect()) as conn:
        return decks.list_decks(conn)


@router.get("/{deck_id}")
def get_tome(deck_id: int) -> dict[str, Any]:
    """One Tome with its slots, ordered by board and then card name."""
    with closing(connect()) as conn:
        deck = decks.get_deck(conn, deck_id)
    if deck is None:
        raise _deck_not_found(deck_id)
    return deck


@router.patch("/{deck_id}")
def amend_tome(deck_id: int, payload: DeckUpdate) -> dict[str, Any]:
    """Amend a Tome's name, format, status, claim flag, notes, or changelog."""
    updates = payload.model_dump(exclude_unset=True)
    with closing(connect()) as conn:
        deck = decks.update_deck(conn, deck_id, updates)
    if deck is None:
        raise _deck_not_found(deck_id)
    return deck


@router.delete("/{deck_id}", status_code=204)
def unbind_tome(deck_id: int) -> Response:
    """Unbind a Tome. Its slots go with it; owned cards stay in the collection."""
    with closing(connect()) as conn:
        deleted = decks.delete_deck(conn, deck_id)
    if not deleted:
        raise _deck_not_found(deck_id)
    return Response(status_code=204)


@router.get("/{deck_id}/breakdown")
def tome_breakdown(deck_id: int) -> dict[str, Any]:
    """Owned versus needed for each slot, with swap hints on the needed ones."""
    with closing(connect()) as conn:
        result = decks.breakdown(conn, deck_id)
    if result is None:
        raise _deck_not_found(deck_id)
    return result


# --- Slots --------------------------------------------------------------------


@router.post("/{deck_id}/cards", status_code=201)
def add_card(deck_id: int, payload: SlotCreate) -> dict[str, Any]:
    """Add copies of a printing to a Tome; an existing slot's quantity grows."""
    with closing(connect()) as conn:
        if not printing_exists(conn, payload.scryfall_id):
            raise _not_in_catalog(payload.scryfall_id)
        try:
            slot = decks.add_slot(conn, deck_id, **payload.model_dump())
        except decks.SlotConflictError as exc:
            raise _conflict(str(exc)) from exc
        except sqlite3.IntegrityError as exc:
            # The Tome or the printing vanished after the checks above, or a
            # CHECK the data layer did not foresee fired. Report the missing
            # row if there is one, else a conflict.
            if not decks.deck_exists(conn, deck_id):
                raise _deck_not_found(deck_id) from exc
            if not printing_exists(conn, payload.scryfall_id):
                raise _not_in_catalog(payload.scryfall_id) from exc
            raise _conflict("The Tome refused this card.") from exc
    if slot is None:
        raise _deck_not_found(deck_id)
    return slot


@router.patch("/{deck_id}/cards/{slot_id}")
def amend_card(deck_id: int, slot_id: int, payload: SlotUpdate) -> dict[str, Any]:
    """Change a slot's quantity, printing, finish, or board."""
    updates = payload.model_dump(exclude_unset=True)
    new_printing = updates.get("scryfall_id")
    with closing(connect()) as conn:
        if not decks.deck_exists(conn, deck_id):
            raise _deck_not_found(deck_id)
        if new_printing is not None and not printing_exists(conn, new_printing):
            raise _not_in_catalog(new_printing)
        try:
            slot = decks.update_slot(conn, deck_id, slot_id, updates)
        except decks.SlotConflictError as exc:
            raise _conflict(str(exc)) from exc
        except sqlite3.IntegrityError as exc:
            # Same fallback as add_card: name the missing row if there is one.
            if not decks.deck_exists(conn, deck_id):
                raise _deck_not_found(deck_id) from exc
            if new_printing is not None and not printing_exists(conn, new_printing):
                raise _not_in_catalog(new_printing) from exc
            raise _conflict("The Tome refused this change.") from exc
    if slot is None:
        raise _slot_not_found(deck_id, slot_id)
    return slot


@router.delete("/{deck_id}/cards/{slot_id}", status_code=204)
def remove_card(deck_id: int, slot_id: int) -> Response:
    """Remove a slot from a Tome."""
    with closing(connect()) as conn:
        if not decks.deck_exists(conn, deck_id):
            raise _deck_not_found(deck_id)
        deleted = decks.delete_slot(conn, deck_id, slot_id)
    if not deleted:
        raise _slot_not_found(deck_id, slot_id)
    return Response(status_code=204)
