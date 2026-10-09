"""Hybrid reservation rule for Tomes (VEG-224, ADR 0020, builds on ADR 0018).

A Tome with ``claims_cards = 1`` reserves the copies its slots name, except
maybeboard slots. A Tome with ``claims_cards = 0`` (a brew) only references
them. Reservation is computed at read time and never stored.

Reads use the :func:`owned_sql` and :func:`reserved_sql` fragments, which
:mod:`scriptorium.inventory` embeds as correlated subqueries. A folio's
``available`` count is owned minus reserved, floored at zero.

Writes use :func:`check_claim`, the contested-only rule: a claiming Tome is
refused only when another claiming Tome already holds copies of the folio and
the Tome would take more than what is left. Wanting a card you own none of, or
more than you own, is allowed and shows as needed in the breakdown.

This module imports nothing from :mod:`scriptorium.decks` or
:mod:`scriptorium.inventory`, so both can import it.
"""

from __future__ import annotations

import sqlite3
from typing import Any

MAYBEBOARD = "maybeboard"


def owned_sql(scryfall_id: str, finish: str) -> str:
    """Scalar subquery: copies owned of the folio named by two SQL expressions."""
    return (
        "(SELECT COALESCE(SUM(inv.quantity), 0) FROM inventory inv "
        f"WHERE inv.scryfall_id = {scryfall_id} AND inv.finish = {finish})"
    )


def reserved_sql(scryfall_id: str, finish: str | None) -> str:
    """Scalar subquery: copies of the folio reserved by claiming Tomes.

    Sums every non-maybeboard slot of every Tome with ``claims_cards = 1``.
    The arguments are SQL expressions, such as ``"i.scryfall_id"`` for a
    correlated subquery or ``"?"`` for a bound parameter. A ``finish`` of
    ``None`` sums every finish of the printing.
    """
    finish_filter = f" AND rdc.finish = {finish}" if finish is not None else ""
    return (
        "(SELECT COALESCE(SUM(rdc.quantity), 0) FROM deck_cards rdc "
        "JOIN decks rd ON rd.id = rdc.deck_id "
        f"WHERE rd.claims_cards = 1 AND rdc.board <> '{MAYBEBOARD}' "
        f"AND rdc.scryfall_id = {scryfall_id}{finish_filter})"
    )


def holders(
    conn: sqlite3.Connection,
    scryfall_id: str,
    finish: str,
    *,
    except_deck_id: int | None = None,
) -> list[dict[str, Any]]:
    """Claiming Tomes that hold the folio, ordered by deck id.

    Each entry has ``deck_id``, ``name``, and ``quantity`` (summed over the
    Tome's non-maybeboard slots). ``except_deck_id`` leaves one Tome out,
    usually the one being written.
    """
    rows = conn.execute(
        "SELECT d.id AS deck_id, d.name, SUM(dc.quantity) AS quantity "
        "FROM deck_cards dc JOIN decks d ON d.id = dc.deck_id "
        f"WHERE d.claims_cards = 1 AND dc.board <> '{MAYBEBOARD}' "
        "AND dc.scryfall_id = ? AND dc.finish = ? AND d.id IS NOT ? "
        "GROUP BY d.id ORDER BY d.id",
        (scryfall_id, finish, except_deck_id),
    ).fetchall()
    return [dict(row) for row in rows]


def own_demand(
    conn: sqlite3.Connection,
    deck_id: int,
    scryfall_id: str,
    finish: str,
    *,
    except_slot_id: int | None = None,
) -> int:
    """Copies of the folio one Tome's non-maybeboard slots ask for.

    ``except_slot_id`` leaves out the slot being amended.
    """
    row = conn.execute(
        "SELECT COALESCE(SUM(quantity), 0) FROM deck_cards "
        f"WHERE deck_id = ? AND scryfall_id = ? AND finish = ? AND board <> '{MAYBEBOARD}' "
        "AND id IS NOT ?",
        (deck_id, scryfall_id, finish, except_slot_id),
    ).fetchone()
    return int(row[0])


class ReservationConflictError(Exception):
    """A claim another Tome already holds the copies for; the router answers 409.

    ``holders`` lists the claiming Tomes in the way, as :func:`holders` returns
    them.
    """

    def __init__(self, message: str, *, holders: list[dict[str, Any]]) -> None:
        super().__init__(message)
        self.holders = holders


def _copies(n: int) -> str:
    return "copy" if n == 1 else "copies"


def _conflict_message(rivals: list[dict[str, Any]], owned: int) -> str:
    held = sum(r["quantity"] for r in rivals)
    free = max(0, owned - held)
    if len(rivals) == 1:
        who = f"{rivals[0]['name']} already claims"
    else:
        named = [f"{r['name']} ({r['quantity']})" for r in rivals]
        who = f"{', '.join(named[:-1])} and {named[-1]} already claim"
    return (
        f"{who} {held} {_copies(held)} of this card, and you own {owned}, "
        f"so {free} {'is' if free == 1 else 'are'} free for this Tome. "
        "Put the extra copies on the maybeboard, or add them to a brew that "
        "does not claim cards."
    )


def check_claim(
    conn: sqlite3.Connection,
    deck_id: int,
    scryfall_id: str,
    finish: str,
    board: str,
    own_after: int,
    *,
    own_before: int = 0,
) -> None:
    """Raise :class:`ReservationConflictError` if the claim is contested.

    ``own_after`` is the Tome's whole demand for the folio after the write,
    across its non-maybeboard slots. ``own_before`` is that demand before the
    write. The write is refused only when all of these hold:

    * the Tome claims cards and ``board`` is not the maybeboard,
    * the write raises the Tome's demand (``own_after > own_before``), so a
      trim on an over-claimed folio always goes through,
    * other claiming Tomes hold copies of the folio, and
    * ``own_after`` exceeds what they leave: ``MAX(0, owned - held_elsewhere)``.
    """
    if board == MAYBEBOARD or own_after <= own_before:
        return
    row = conn.execute("SELECT claims_cards FROM decks WHERE id = ?", (deck_id,)).fetchone()
    if row is None or not row[0]:
        return
    rivals = holders(conn, scryfall_id, finish, except_deck_id=deck_id)
    held_elsewhere = sum(r["quantity"] for r in rivals)
    if held_elsewhere == 0:
        return
    owned = int(conn.execute(f"SELECT {owned_sql('?', '?')}", (scryfall_id, finish)).fetchone()[0])
    if own_after > max(0, owned - held_elsewhere):
        raise ReservationConflictError(_conflict_message(rivals, owned), holders=rivals)
