"""Tests for a Tome's reservations across its life (VEG-226, ADR 0018, ADR 0020).

VEG-226 asks for six things:

1. Creating a deck with claims_cards=true reserves cards from the available pool.
2. Creating a deck with claims_cards=false does not affect availability.
3. Over-reservation is prevented.
4. Toggling claims_cards on an existing deck correctly updates availability.
5. Removing a card from a reserving deck returns it to the available pool.
6. Owned vs needed breakdown calculates correctly.

Criteria 3 and 6 are covered in ``tests/test_reservations.py``, the contested
section of ``tests/test_decks.py``, and the breakdown reference table there.
This module covers the other four. Each test walks a Tome through its life with
the production functions in :mod:`scriptorium.decks` and reads the folio's
availability back through :mod:`scriptorium.inventory` after each step, so a
write that stores the wrong value shows up as a wrong count.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from contextlib import closing
from pathlib import Path
from typing import Any

import pytest

from scriptorium import db, decks, inventory, reservations
from scriptorium.migrations import apply_migrations

_REQUIRED_DEFAULTS = {
    "set_code": "tst",
    "set_name": "Test Set",
    "collector_number": "1",
    "rarity": "common",
    "lang": "en",
    "layout": "normal",
}


def _insert_card(
    conn: sqlite3.Connection, scryfall_id: str, name: str, **overrides: object
) -> None:
    cols = {"scryfall_id": scryfall_id, "name": name, **_REQUIRED_DEFAULTS, **overrides}
    placeholders = ", ".join("?" for _ in cols)
    conn.execute(
        f"INSERT INTO cards ({', '.join(cols)}) VALUES ({placeholders})",
        tuple(cols.values()),
    )


@pytest.fixture
def catalog_conn(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[sqlite3.Connection]:
    monkeypatch.setenv("SCRIPTORIUM_DB_PATH", str(tmp_path / "catalog.db"))
    conn = db.connect()
    apply_migrations(conn)
    _insert_card(conn, "bolt-1", "Lightning Bolt")
    _insert_card(conn, "ghast-1", "Bloodghast")
    conn.commit()
    with closing(conn):
        yield conn


def _deck(conn: sqlite3.Connection, name: str = "Edgar's Court", **fields: Any) -> int:
    deck_id: int = decks.create_deck(conn, name=name, **fields)["id"]
    return deck_id


def _slot(
    conn: sqlite3.Connection, deck_id: int, scryfall_id: str, **fields: Any
) -> dict[str, Any]:
    slot = decks.add_slot(conn, deck_id, scryfall_id=scryfall_id, **fields)
    assert slot is not None
    return slot


def _lot(conn: sqlite3.Connection, scryfall_id: str, quantity: int, **fields: Any) -> int:
    lot_id: int = inventory.create_lot(conn, scryfall_id=scryfall_id, quantity=quantity, **fields)[
        "id"
    ]
    return lot_id


def _folio(
    conn: sqlite3.Connection, scryfall_id: str, finish: str = "nonfoil"
) -> tuple[int, int, int]:
    """``(owned, reserved, available)`` for one folio, from the printing's detail view.

    The view lists only finishes that are owned or reserved, so an absent
    finish reads as all zeros.
    """
    for row in inventory.owned_for_printing(conn, scryfall_id)["reservations"]:
        if row["finish"] == finish:
            return (row["owned"], row["reserved"], row["available"])
    return (0, 0, 0)


def _lot_folio(conn: sqlite3.Connection, lot_id: int) -> dict[str, Any]:
    """The folio totals one lot carries, as ``GET /inventory/{id}`` returns them."""
    lot = inventory.get_lot(conn, lot_id)
    assert lot is not None
    folio: dict[str, Any] = lot["folio"]
    return folio


def _search_folio(
    conn: sqlite3.Connection, scryfall_id: str, finish: str = "nonfoil"
) -> tuple[int, int]:
    """``(reserved, available)`` for one folio, as The Index search reports it."""
    results, _ = inventory.search_folios(conn, inventory.SearchFilters())
    (row,) = [r for r in results if r["scryfall_id"] == scryfall_id and r["finish"] == finish]
    return (row["reserved"], row["available"])


def _breakdown_line(conn: sqlite3.Connection, deck_id: int) -> dict[str, Any]:
    """The only breakdown line of a Tome that holds a single slot."""
    result = decks.breakdown(conn, deck_id)
    assert result is not None
    (line,) = result["lines"]
    found: dict[str, Any] = line
    return found


# --- claiming and brewing -----------------------------------------------------


def test_claiming_tome_reserves_copies_from_the_pool(catalog_conn: sqlite3.Connection) -> None:
    lot_id = _lot(catalog_conn, "bolt-1", 4)
    assert _folio(catalog_conn, "bolt-1") == (4, 0, 4)

    deck_id = _deck(catalog_conn)
    _slot(catalog_conn, deck_id, "bolt-1", quantity=3)

    assert _folio(catalog_conn, "bolt-1") == (4, 3, 1)
    assert _lot_folio(catalog_conn, lot_id) == {"owned": 4, "reserved": 3, "available": 1}
    assert _search_folio(catalog_conn, "bolt-1") == (3, 1)


def test_brew_leaves_availability_alone(catalog_conn: sqlite3.Connection) -> None:
    lot_id = _lot(catalog_conn, "bolt-1", 4)

    brew_id = _deck(catalog_conn, "Brew", claims_cards=False)
    _slot(catalog_conn, brew_id, "bolt-1", quantity=3)

    assert _folio(catalog_conn, "bolt-1") == (4, 0, 4)
    assert _lot_folio(catalog_conn, lot_id) == {"owned": 4, "reserved": 0, "available": 4}
    assert _search_folio(catalog_conn, "bolt-1") == (0, 4)
    # A brew reserves nothing, but the breakdown still counts the copies as had.
    line = _breakdown_line(catalog_conn, brew_id)
    assert (line["have"], line["needed"]) == (3, 0)


# --- toggling claims_cards ----------------------------------------------------


def test_turning_claims_off_releases_the_copies(catalog_conn: sqlite3.Connection) -> None:
    _lot(catalog_conn, "bolt-1", 4)
    deck_id = _deck(catalog_conn)
    _slot(catalog_conn, deck_id, "bolt-1", quantity=3)
    assert _folio(catalog_conn, "bolt-1") == (4, 3, 1)

    decks.update_deck(catalog_conn, deck_id, {"claims_cards": False})

    assert _folio(catalog_conn, "bolt-1") == (4, 0, 4)


def test_turning_claims_on_reserves_the_copies(catalog_conn: sqlite3.Connection) -> None:
    _lot(catalog_conn, "bolt-1", 4)
    brew_id = _deck(catalog_conn, "Brew", claims_cards=False)
    _slot(catalog_conn, brew_id, "bolt-1", quantity=3)
    assert _folio(catalog_conn, "bolt-1") == (4, 0, 4)

    decks.update_deck(catalog_conn, brew_id, {"claims_cards": True})

    assert _folio(catalog_conn, "bolt-1") == (4, 3, 1)


def test_turning_claims_on_can_leave_the_folio_over_claimed(
    catalog_conn: sqlite3.Connection,
) -> None:
    """ADR 0020 checks slot writes only, so the toggle goes through.

    ADR 0020 also says an over-claimed Tome shows its shortfall as needed. The
    breakdown gives each claiming Tome what the others leave, with no priority
    for whoever claimed first, so both Tomes come up short.
    """
    _lot(catalog_conn, "bolt-1", 1)
    rival_id = _deck(catalog_conn, "Rival Court")
    _slot(catalog_conn, rival_id, "bolt-1", quantity=1)
    brew_id = _deck(catalog_conn, "Brew", claims_cards=False)
    _slot(catalog_conn, brew_id, "bolt-1", quantity=4)

    decks.update_deck(catalog_conn, brew_id, {"claims_cards": True})

    assert _folio(catalog_conn, "bolt-1") == (1, 5, 0)
    brew_line = _breakdown_line(catalog_conn, brew_id)
    assert (brew_line["have"], brew_line["needed"]) == (0, 4)
    rival_line = _breakdown_line(catalog_conn, rival_id)
    assert (rival_line["have"], rival_line["needed"]) == (0, 1)


# --- slot writes in a claiming Tome -------------------------------------------


def test_maybeboard_slots_never_reserve_through_the_write_path(
    catalog_conn: sqlite3.Connection,
) -> None:
    _lot(catalog_conn, "bolt-1", 4)
    deck_id = _deck(catalog_conn)
    slot = _slot(catalog_conn, deck_id, "bolt-1", quantity=4, board="maybeboard")

    assert _folio(catalog_conn, "bolt-1") == (4, 0, 4)

    decks.update_slot(catalog_conn, deck_id, slot["id"], {"board": "main"})

    assert _folio(catalog_conn, "bolt-1") == (4, 4, 0)


def test_trimming_a_slot_returns_the_difference(catalog_conn: sqlite3.Connection) -> None:
    _lot(catalog_conn, "bolt-1", 4)
    deck_id = _deck(catalog_conn)
    slot = _slot(catalog_conn, deck_id, "bolt-1", quantity=3)

    decks.update_slot(catalog_conn, deck_id, slot["id"], {"quantity": 1})

    assert _folio(catalog_conn, "bolt-1") == (4, 1, 3)


def test_moving_a_slot_to_the_maybeboard_returns_its_copies(
    catalog_conn: sqlite3.Connection,
) -> None:
    _lot(catalog_conn, "bolt-1", 4)
    deck_id = _deck(catalog_conn)
    slot = _slot(catalog_conn, deck_id, "bolt-1", quantity=3)

    decks.update_slot(catalog_conn, deck_id, slot["id"], {"board": "maybeboard"})

    assert _folio(catalog_conn, "bolt-1") == (4, 0, 4)


def test_deleting_a_slot_returns_its_copies(catalog_conn: sqlite3.Connection) -> None:
    _lot(catalog_conn, "bolt-1", 4)
    deck_id = _deck(catalog_conn)
    main = _slot(catalog_conn, deck_id, "bolt-1", quantity=3)
    _slot(catalog_conn, deck_id, "bolt-1", quantity=1, board="sideboard")
    assert _folio(catalog_conn, "bolt-1") == (4, 4, 0)

    assert decks.delete_slot(catalog_conn, deck_id, main["id"])

    # The sideboard copy stays reserved.
    assert _folio(catalog_conn, "bolt-1") == (4, 1, 3)


def test_unbinding_a_tome_returns_every_copy(catalog_conn: sqlite3.Connection) -> None:
    _lot(catalog_conn, "bolt-1", 4)
    _lot(catalog_conn, "ghast-1", 2)
    deck_id = _deck(catalog_conn)
    _slot(catalog_conn, deck_id, "bolt-1", quantity=3)
    _slot(catalog_conn, deck_id, "ghast-1", quantity=2)
    inventory_sql = "SELECT COUNT(*), SUM(quantity) FROM inventory"
    before = tuple(catalog_conn.execute(inventory_sql).fetchone())

    assert decks.delete_deck(catalog_conn, deck_id)

    assert _folio(catalog_conn, "bolt-1") == (4, 0, 4)
    assert _folio(catalog_conn, "ghast-1") == (2, 0, 2)
    # Unbinding releases the claim and leaves the Volume's copies where they are.
    assert tuple(catalog_conn.execute(inventory_sql).fetchone()) == before


def test_swapping_finish_moves_the_claim_between_folios(
    catalog_conn: sqlite3.Connection,
) -> None:
    _lot(catalog_conn, "bolt-1", 2)
    _lot(catalog_conn, "bolt-1", 1, finish="foil")
    deck_id = _deck(catalog_conn)
    slot = _slot(catalog_conn, deck_id, "bolt-1", quantity=1)

    decks.update_slot(catalog_conn, deck_id, slot["id"], {"finish": "foil"})

    assert _folio(catalog_conn, "bolt-1") == (2, 0, 2)
    assert _folio(catalog_conn, "bolt-1", "foil") == (1, 1, 0)


def test_release_makes_room_for_a_rival(catalog_conn: sqlite3.Connection) -> None:
    _lot(catalog_conn, "bolt-1", 2)
    first_id = _deck(catalog_conn, "First Court")
    _slot(catalog_conn, first_id, "bolt-1", quantity=2)
    second_id = _deck(catalog_conn, "Second Court")

    with pytest.raises(reservations.ReservationConflictError):
        decks.add_slot(catalog_conn, second_id, scryfall_id="bolt-1", quantity=1)

    decks.update_deck(catalog_conn, first_id, {"claims_cards": False})
    _slot(catalog_conn, second_id, "bolt-1", quantity=1)

    assert _folio(catalog_conn, "bolt-1") == (2, 1, 1)
