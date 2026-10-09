"""Tests for the hybrid reservation rule (VEG-224, ADR 0020).

A Tome with ``claims_cards = 1`` reserves the copies its non-maybeboard slots
name. :func:`reservations.holders` lists the Tomes holding a folio, and
:func:`reservations.check_claim` is the write-time rule: a claiming Tome is
refused only when another claiming Tome already holds copies of the folio and
the request would take more than what is left.

Rows are inserted raw so these tests don't depend on :mod:`scriptorium.decks`.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from contextlib import closing
from pathlib import Path

import pytest

from scriptorium import db, reservations
from scriptorium.migrations import apply_migrations

_REQUIRED_DEFAULTS = {
    "set_code": "tst",
    "set_name": "Test Set",
    "collector_number": "1",
    "rarity": "common",
    "lang": "en",
    "layout": "normal",
}


def _insert_row(conn: sqlite3.Connection, table: str, **cols: object) -> int:
    placeholders = ", ".join("?" for _ in cols)
    cur = conn.execute(
        f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({placeholders})",
        tuple(cols.values()),
    )
    assert cur.lastrowid is not None
    return cur.lastrowid


@pytest.fixture
def conn(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[sqlite3.Connection]:
    monkeypatch.setenv("SCRIPTORIUM_DB_PATH", str(tmp_path / "catalog.db"))
    connection = db.connect()
    apply_migrations(connection)
    _insert_row(
        connection, "cards", scryfall_id="bolt-1", name="Lightning Bolt", **_REQUIRED_DEFAULTS
    )
    _insert_row(connection, "cards", scryfall_id="ghast-1", name="Bloodghast", **_REQUIRED_DEFAULTS)
    connection.commit()
    with closing(connection):
        yield connection


def _own(conn: sqlite3.Connection, quantity: int, *, finish: str = "nonfoil") -> None:
    _insert_row(conn, "inventory", scryfall_id="bolt-1", quantity=quantity, finish=finish)


def _tome(conn: sqlite3.Connection, name: str, *, claims: bool = True) -> int:
    return _insert_row(conn, "decks", name=name, claims_cards=int(claims))


def _hold(
    conn: sqlite3.Connection,
    deck_id: int,
    quantity: int,
    *,
    board: str = "main",
    finish: str = "nonfoil",
    scryfall_id: str = "bolt-1",
) -> int:
    return _insert_row(
        conn,
        "deck_cards",
        deck_id=deck_id,
        scryfall_id=scryfall_id,
        finish=finish,
        board=board,
        quantity=quantity,
    )


def _check(
    conn: sqlite3.Connection,
    deck_id: int,
    own_after: int,
    *,
    board: str = "main",
    own_before: int = 0,
) -> None:
    reservations.check_claim(
        conn, deck_id, "bolt-1", "nonfoil", board, own_after, own_before=own_before
    )


# --- holders ----------------------------------------------------------------


def test_holders_lists_claiming_tomes_by_id(conn: sqlite3.Connection) -> None:
    first = _tome(conn, "Edgar's Court")
    brew = _tome(conn, "Brew", claims=False)
    second = _tome(conn, "Vampire Tribal")
    _hold(conn, second, 1)
    _hold(conn, first, 2)
    _hold(conn, first, 1, board="sideboard")
    _hold(conn, first, 5, board="maybeboard")
    _hold(conn, brew, 4)

    assert reservations.holders(conn, "bolt-1", "nonfoil") == [
        {"deck_id": first, "name": "Edgar's Court", "quantity": 3},
        {"deck_id": second, "name": "Vampire Tribal", "quantity": 1},
    ]
    assert reservations.holders(conn, "bolt-1", "nonfoil", except_deck_id=first) == [
        {"deck_id": second, "name": "Vampire Tribal", "quantity": 1},
    ]
    assert reservations.holders(conn, "bolt-1", "foil") == []


# --- own_demand -------------------------------------------------------------


def test_own_demand_sums_the_tomes_non_maybeboard_slots(conn: sqlite3.Connection) -> None:
    tome = _tome(conn, "Sleeved")
    main = _hold(conn, tome, 2)
    _hold(conn, tome, 1, board="sideboard")
    _hold(conn, tome, 4, board="maybeboard")
    _hold(conn, tome, 1, finish="foil")
    _hold(conn, _tome(conn, "Rival"), 3)

    assert reservations.own_demand(conn, tome, "bolt-1", "nonfoil") == 3
    assert reservations.own_demand(conn, tome, "bolt-1", "nonfoil", except_slot_id=main) == 1


# --- check_claim ------------------------------------------------------------


def test_check_claim_allows_an_unowned_card(conn: sqlite3.Connection) -> None:
    _check(conn, _tome(conn, "Sleeved"), 4)


def test_check_claim_allows_more_than_owned_with_no_rival(conn: sqlite3.Connection) -> None:
    _own(conn, 2)
    _check(conn, _tome(conn, "Sleeved"), 4)


def test_check_claim_allows_a_request_that_fits_beside_a_rival(
    conn: sqlite3.Connection,
) -> None:
    _own(conn, 4)
    _hold(conn, _tome(conn, "Rival"), 1)
    _check(conn, _tome(conn, "Sleeved"), 3)


def test_check_claim_refuses_a_request_past_what_the_rival_leaves(
    conn: sqlite3.Connection,
) -> None:
    _own(conn, 4)
    rival = _tome(conn, "Edgar's Court")
    _hold(conn, rival, 3)
    tome = _tome(conn, "Sleeved")
    with pytest.raises(reservations.ReservationConflictError) as excinfo:
        _check(conn, tome, 2)
    assert excinfo.value.holders == [{"deck_id": rival, "name": "Edgar's Court", "quantity": 3}]
    message = str(excinfo.value)
    assert "Edgar's Court" in message
    assert "maybeboard" in message


def test_check_claim_refuses_any_copy_when_rivals_hold_all(conn: sqlite3.Connection) -> None:
    _own(conn, 2)
    first = _tome(conn, "Edgar's Court")
    second = _tome(conn, "Vampire Tribal")
    _hold(conn, first, 1)
    _hold(conn, second, 1)
    with pytest.raises(reservations.ReservationConflictError) as excinfo:
        _check(conn, _tome(conn, "Sleeved"), 1)
    assert [h["deck_id"] for h in excinfo.value.holders] == [first, second]
    message = str(excinfo.value)
    assert "Edgar's Court" in message and "Vampire Tribal" in message


def test_check_claim_refuses_an_unowned_folio_a_rival_already_wants(
    conn: sqlite3.Connection,
) -> None:
    """A rival claim on zero owned copies leaves nothing, so any claim is refused."""
    _hold(conn, _tome(conn, "Rival"), 1)
    with pytest.raises(reservations.ReservationConflictError):
        _check(conn, _tome(conn, "Sleeved"), 1)


def test_check_claim_never_refuses_a_non_claiming_tome(conn: sqlite3.Connection) -> None:
    _own(conn, 1)
    _hold(conn, _tome(conn, "Rival"), 1)
    _check(conn, _tome(conn, "Brew", claims=False), 4)


def test_check_claim_never_refuses_the_maybeboard(conn: sqlite3.Connection) -> None:
    _own(conn, 1)
    _hold(conn, _tome(conn, "Rival"), 1)
    _check(conn, _tome(conn, "Sleeved"), 4, board="maybeboard")


def test_check_claim_counts_the_tomes_whole_demand(conn: sqlite3.Connection) -> None:
    """own_after is the Tome's total on the folio, so other slots count against it."""
    _own(conn, 4)
    _hold(conn, _tome(conn, "Rival"), 2)
    tome = _tome(conn, "Sleeved")
    _check(conn, tome, 2)
    with pytest.raises(reservations.ReservationConflictError):
        _check(conn, tome, 3)


def test_check_claim_allows_a_decrease_on_an_over_claimed_folio(
    conn: sqlite3.Connection,
) -> None:
    """Selling a lot can leave a Tome over-claimed. Trimming it must still work."""
    _own(conn, 3)
    _hold(conn, _tome(conn, "Rival"), 2)
    tome = _tome(conn, "Sleeved")
    _check(conn, tome, 3, own_before=4)
    _check(conn, tome, 4, own_before=4)
    with pytest.raises(reservations.ReservationConflictError):
        _check(conn, tome, 5, own_before=4)
