"""Tests for the owned-inventory read/write layer (VEG-218, builds on ADR 0009).

Seed a fresh tmp catalog with a few printings, then exercise the CRUD functions
over the ``inventory`` table: create/list/get/update/delete a lot, the folio
rollup for a printing, and the JSON (de)serialization of ``tags``. List and
detail reads enrich each lot with a nested ``card`` object joined from ``cards``.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from contextlib import closing
from pathlib import Path
from typing import Any

import pytest

from scriptorium import db, inventory
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
    _insert_card(
        conn,
        "bolt-1",
        "Lightning Bolt",
        set_code="lea",
        set_name="Limited Edition Alpha",
        collector_number="161",
        image_uris='{"normal":"https://img/bolt.jpg"}',
    )
    _insert_card(conn, "helix-1", "Lightning Helix")
    conn.commit()
    with closing(conn):
        yield conn


# --- create_lot ------------------------------------------------------------


def test_create_lot_returns_enriched_row_with_defaults(catalog_conn: sqlite3.Connection) -> None:
    lot = inventory.create_lot(catalog_conn, scryfall_id="bolt-1")
    assert lot["id"] >= 1
    assert lot["scryfall_id"] == "bolt-1"
    assert (lot["quantity"], lot["finish"], lot["condition"], lot["language"]) == (
        1,
        "nonfoil",
        "NM",
        "en",
    )
    assert lot["location"] is None and lot["tags"] is None
    # Enriched with a nested card object joined from `cards`.
    assert lot["card"]["name"] == "Lightning Bolt"
    assert lot["card"]["set_code"] == "lea"
    assert lot["card"]["collector_number"] == "161"
    assert lot["card"]["image_uris"] == {"normal": "https://img/bolt.jpg"}


def test_create_lot_persists_all_fields_and_serializes_tags(
    catalog_conn: sqlite3.Connection,
) -> None:
    lot = inventory.create_lot(
        catalog_conn,
        scryfall_id="bolt-1",
        quantity=3,
        finish="foil",
        condition="LP",
        location="Volume I",
        acquired_at="2026-01-01",
        price_paid="4.50",
        notes="signed",
        tags=["staple", "burn"],
    )
    assert lot["quantity"] == 3
    assert lot["finish"] == "foil"
    assert lot["tags"] == ["staple", "burn"]
    # tags are stored as JSON text in the column.
    raw = catalog_conn.execute("SELECT tags FROM inventory WHERE id = ?", (lot["id"],)).fetchone()[
        0
    ]
    assert raw == '["staple", "burn"]'


def test_create_lot_commits(catalog_conn: sqlite3.Connection) -> None:
    """A created lot survives on a fresh connection — the write is committed."""
    lot = inventory.create_lot(catalog_conn, scryfall_id="bolt-1")
    with closing(db.connect()) as other:
        row = other.execute("SELECT id FROM inventory WHERE id = ?", (lot["id"],)).fetchone()
    assert row is not None


def test_create_lot_unknown_printing_violates_fk(catalog_conn: sqlite3.Connection) -> None:
    """The data-layer FK contract the API's 404 guard relies on: an orphan lot
    is rejected, never silently accepted."""
    with pytest.raises(sqlite3.IntegrityError):
        inventory.create_lot(catalog_conn, scryfall_id="ghost")


def test_create_lot_empty_tags_round_trip(catalog_conn: sqlite3.Connection) -> None:
    """An empty tags list is preserved as ``[]`` (stored '[]'), distinct from None."""
    lot = inventory.create_lot(catalog_conn, scryfall_id="bolt-1", tags=[])
    assert lot["tags"] == []
    raw = catalog_conn.execute("SELECT tags FROM inventory WHERE id = ?", (lot["id"],)).fetchone()[
        0
    ]
    assert raw == "[]"


# --- create_lots (bulk) ----------------------------------------------------


def test_create_lots_inserts_all_and_returns_enriched(catalog_conn: sqlite3.Connection) -> None:
    lots = inventory.create_lots(
        catalog_conn,
        [
            {"scryfall_id": "bolt-1", "quantity": 2, "finish": "foil"},
            {"scryfall_id": "helix-1", "quantity": 1},
        ],
    )
    assert [lot["scryfall_id"] for lot in lots] == ["bolt-1", "helix-1"]
    assert lots[0]["quantity"] == 2 and lots[0]["finish"] == "foil"
    assert lots[0]["card"]["name"] == "Lightning Bolt"
    # Defaults fill the NOT-NULL columns a row omits.
    assert (lots[1]["finish"], lots[1]["condition"], lots[1]["language"]) == (
        "nonfoil",
        "NM",
        "en",
    )


def test_create_lots_is_atomic_on_a_bad_row(catalog_conn: sqlite3.Connection) -> None:
    """One unknown printing rolls the whole batch back — no partial collection."""
    with pytest.raises(sqlite3.IntegrityError):
        inventory.create_lots(
            catalog_conn,
            [
                {"scryfall_id": "bolt-1", "quantity": 1},
                {"scryfall_id": "ghost", "quantity": 1},  # FK violation
            ],
        )
    # The good row before the bad one must not have landed.
    count = catalog_conn.execute("SELECT COUNT(*) FROM inventory").fetchone()[0]
    assert count == 0


def test_create_lots_commits(catalog_conn: sqlite3.Connection) -> None:
    inventory.create_lots(catalog_conn, [{"scryfall_id": "bolt-1", "quantity": 1}])
    with closing(db.connect()) as other:
        count = other.execute("SELECT COUNT(*) FROM inventory").fetchone()[0]
    assert count == 1


def test_create_lots_applies_defaults_for_explicit_none(catalog_conn: sqlite3.Connection) -> None:
    """A NOT-NULL column passed as explicit None falls back to the schema default."""
    row = {
        "scryfall_id": "bolt-1",
        "quantity": None,
        "finish": None,
        "condition": None,
        "language": None,
    }
    lots = inventory.create_lots(catalog_conn, [row])
    assert (lots[0]["quantity"], lots[0]["finish"], lots[0]["condition"], lots[0]["language"]) == (
        1,
        "nonfoil",
        "NM",
        "en",
    )


def test_create_lots_keeps_duplicate_rows_as_separate_lots(
    catalog_conn: sqlite3.Connection,
) -> None:
    """Two identical rows (e.g. a repeated decklist line) become two distinct lots."""
    lots = inventory.create_lots(
        catalog_conn,
        [{"scryfall_id": "bolt-1", "quantity": 1}, {"scryfall_id": "bolt-1", "quantity": 1}],
    )
    assert len({lot["id"] for lot in lots}) == 2
    total = catalog_conn.execute("SELECT COUNT(*) FROM inventory").fetchone()[0]
    assert total == 2


def test_create_lots_round_trips_tags(catalog_conn: sqlite3.Connection) -> None:
    lots = inventory.create_lots(catalog_conn, [{"scryfall_id": "bolt-1", "tags": ["staple"]}])
    assert lots[0]["tags"] == ["staple"]


# --- existing_printing_ids -------------------------------------------------


def test_existing_printing_ids_filters_to_present(catalog_conn: sqlite3.Connection) -> None:
    present = inventory.existing_printing_ids(catalog_conn, ["bolt-1", "helix-1", "ghost"])
    assert present == {"bolt-1", "helix-1"}
    assert inventory.existing_printing_ids(catalog_conn, []) == set()


def test_existing_printing_ids_crosses_chunk_boundary(catalog_conn: sqlite3.Connection) -> None:
    """More distinct ids than _ID_QUERY_CHUNK are all resolved across chunks."""
    ids = [f"card-{i:04d}" for i in range(1200)]  # > 2 chunks of 500
    for scryfall_id in ids:
        _insert_card(catalog_conn, scryfall_id, "Filler")
    catalog_conn.commit()
    present = inventory.existing_printing_ids(catalog_conn, [*ids, "ghost-a", "ghost-b"])
    assert present == set(ids)


# --- printing_exists -------------------------------------------------------


def test_printing_exists(catalog_conn: sqlite3.Connection) -> None:
    assert inventory.printing_exists(catalog_conn, "bolt-1") is True
    assert inventory.printing_exists(catalog_conn, "no-such-card") is False


# --- list_lots -------------------------------------------------------------


def test_list_lots_returns_results_and_total_newest_first(
    catalog_conn: sqlite3.Connection,
) -> None:
    first = inventory.create_lot(catalog_conn, scryfall_id="bolt-1")
    second = inventory.create_lot(catalog_conn, scryfall_id="helix-1")
    results, total = inventory.list_lots(catalog_conn)
    assert total == 2
    assert [r["id"] for r in results] == [second["id"], first["id"]]
    assert results[0]["card"]["name"] == "Lightning Helix"


def test_list_lots_paginates(catalog_conn: sqlite3.Connection) -> None:
    for _ in range(3):
        inventory.create_lot(catalog_conn, scryfall_id="bolt-1")
    results, total = inventory.list_lots(catalog_conn, limit=1, offset=1)
    assert total == 3
    assert len(results) == 1


# --- get_lot ---------------------------------------------------------------


def test_get_lot_returns_enriched_or_none(catalog_conn: sqlite3.Connection) -> None:
    created = inventory.create_lot(catalog_conn, scryfall_id="bolt-1", tags=["x"])
    fetched = inventory.get_lot(catalog_conn, created["id"])
    assert fetched is not None
    assert fetched["tags"] == ["x"]
    assert fetched["card"]["name"] == "Lightning Bolt"
    assert inventory.get_lot(catalog_conn, 999999) is None


# --- update_lot ------------------------------------------------------------


def test_update_lot_changes_provided_fields(catalog_conn: sqlite3.Connection) -> None:
    lot = inventory.create_lot(catalog_conn, scryfall_id="bolt-1", quantity=1, notes="old")
    updated = inventory.update_lot(
        catalog_conn,
        lot["id"],
        {"quantity": 5, "condition": "MP", "location": "Box A", "notes": "new"},
    )
    assert updated is not None
    assert (updated["quantity"], updated["condition"], updated["location"], updated["notes"]) == (
        5,
        "MP",
        "Box A",
        "new",
    )


def test_update_lot_can_clear_nullable_field(catalog_conn: sqlite3.Connection) -> None:
    lot = inventory.create_lot(catalog_conn, scryfall_id="bolt-1", location="Box A", notes="hi")
    updated = inventory.update_lot(catalog_conn, lot["id"], {"location": None})
    assert updated is not None
    assert updated["location"] is None
    assert updated["notes"] == "hi"  # untouched


def test_update_lot_empty_is_noop(catalog_conn: sqlite3.Connection) -> None:
    lot = inventory.create_lot(catalog_conn, scryfall_id="bolt-1", quantity=2)
    updated = inventory.update_lot(catalog_conn, lot["id"], {})
    assert updated is not None
    assert updated["quantity"] == 2


def test_update_lot_missing_returns_none(catalog_conn: sqlite3.Connection) -> None:
    assert inventory.update_lot(catalog_conn, 999999, {"quantity": 2}) is None


def test_update_lot_ignores_keys_outside_the_allowlist(catalog_conn: sqlite3.Connection) -> None:
    """Only _UPDATABLE_COLUMNS are written; a stray key can't reach the SQL."""
    lot = inventory.create_lot(catalog_conn, scryfall_id="bolt-1", finish="nonfoil")
    updated = inventory.update_lot(
        catalog_conn,
        lot["id"],
        {"quantity": 2, "finish": "foil", "scryfall_id": "helix-1"},
    )
    assert updated is not None
    assert updated["quantity"] == 2  # allowed field applied
    assert updated["finish"] == "nonfoil"  # ignored, not changed
    assert updated["scryfall_id"] == "bolt-1"  # ignored, not changed


# --- delete_lot ------------------------------------------------------------


def test_delete_lot_removes_and_reports(catalog_conn: sqlite3.Connection) -> None:
    lot = inventory.create_lot(catalog_conn, scryfall_id="bolt-1")
    assert inventory.delete_lot(catalog_conn, lot["id"]) is True
    assert inventory.get_lot(catalog_conn, lot["id"]) is None
    assert inventory.delete_lot(catalog_conn, lot["id"]) is False


# --- owned_for_printing ----------------------------------------------------


def test_owned_for_printing_rolls_up_by_folio(catalog_conn: sqlite3.Connection) -> None:
    inventory.create_lot(catalog_conn, scryfall_id="bolt-1", finish="nonfoil", quantity=2)
    inventory.create_lot(catalog_conn, scryfall_id="bolt-1", finish="nonfoil", quantity=1)
    inventory.create_lot(catalog_conn, scryfall_id="bolt-1", finish="foil", quantity=1)
    owned = inventory.owned_for_printing(catalog_conn, "bolt-1")

    assert owned["scryfall_id"] == "bolt-1"
    assert owned["card"]["name"] == "Lightning Bolt"
    assert owned["total_quantity"] == 4
    assert len(owned["lots"]) == 3
    # Rollup groups by (finish, condition, language); two nonfoil lots collapse.
    rollup = {(r["finish"], r["condition"], r["language"]): r for r in owned["rollup"]}
    assert rollup[("nonfoil", "NM", "en")]["quantity"] == 3
    assert rollup[("nonfoil", "NM", "en")]["lots"] == 2
    assert rollup[("foil", "NM", "en")]["quantity"] == 1


def test_owned_for_printing_unowned_is_empty(catalog_conn: sqlite3.Connection) -> None:
    owned = inventory.owned_for_printing(catalog_conn, "helix-1")
    assert owned["total_quantity"] == 0
    assert owned["lots"] == []
    assert owned["rollup"] == []
    assert owned["card"]["name"] == "Lightning Helix"


# --- owned_across_printings ------------------------------------------------


def _set_oracle_id(conn: sqlite3.Connection, scryfall_id: str, oracle_id: str | None) -> None:
    conn.execute("UPDATE cards SET oracle_id = ? WHERE scryfall_id = ?", (oracle_id, scryfall_id))
    conn.commit()


def _across(conn: sqlite3.Connection, scryfall_id: str) -> dict[str, Any]:
    """Summary for a printing expected to exist (narrows away the None case)."""
    across = inventory.owned_across_printings(conn, scryfall_id)
    assert across is not None
    return across


def test_owned_across_printings_sums_every_printing_of_one_card(
    catalog_conn: sqlite3.Connection,
) -> None:
    """Two printings sharing an oracle_id roll into one card-level total."""
    _insert_card(
        catalog_conn,
        "bolt-2",
        "Lightning Bolt",
        set_code="2x2",
        set_name="Double Masters 2022",
        collector_number="117",
    )
    _set_oracle_id(catalog_conn, "bolt-1", "oracle-bolt")
    _set_oracle_id(catalog_conn, "bolt-2", "oracle-bolt")
    inventory.create_lot(catalog_conn, scryfall_id="bolt-1", quantity=3)
    inventory.create_lot(catalog_conn, scryfall_id="bolt-2", quantity=4)

    across = _across(catalog_conn, "bolt-1")

    assert across["grouping"] == "oracle_id"
    assert across["oracle_id"] == "oracle-bolt"
    assert across["name"] == "Lightning Bolt"
    assert across["total_quantity"] == 7
    assert across["printing_count"] == 2
    by_id = {p["scryfall_id"]: p for p in across["printings"]}
    assert by_id["bolt-1"]["quantity"] == 3
    assert by_id["bolt-2"]["quantity"] == 4
    assert by_id["bolt-2"]["set_name"] == "Double Masters 2022"
    assert by_id["bolt-2"]["collector_number"] == "117"


def test_owned_across_printings_counts_finishes_together(
    catalog_conn: sqlite3.Connection,
) -> None:
    """Foil and nonfoil are separate folios but the same card for the total."""
    _set_oracle_id(catalog_conn, "bolt-1", "oracle-bolt")
    inventory.create_lot(catalog_conn, scryfall_id="bolt-1", finish="nonfoil", quantity=2)
    inventory.create_lot(catalog_conn, scryfall_id="bolt-1", finish="foil", quantity=1)

    across = _across(catalog_conn, "bolt-1")

    assert across["total_quantity"] == 3
    assert across["printing_count"] == 1
    assert across["printings"][0]["lots"] == 2


def test_owned_across_printings_falls_back_to_name_without_oracle_id(
    catalog_conn: sqlite3.Connection,
) -> None:
    """A NULL oracle_id groups by card name instead.

    `WHERE oracle_id = NULL` matches nothing in SQLite, so without the fallback
    a card the bulk import left un-oracled would report only its own printing.
    """
    _insert_card(
        catalog_conn,
        "bolt-3",
        "Lightning Bolt",
        set_code="m10",
        set_name="Magic 2010",
        collector_number="146",
    )
    inventory.create_lot(catalog_conn, scryfall_id="bolt-1", quantity=1)
    inventory.create_lot(catalog_conn, scryfall_id="bolt-3", quantity=2)

    across = _across(catalog_conn, "bolt-1")

    assert across["grouping"] == "name"
    assert across["oracle_id"] is None
    assert across["total_quantity"] == 3
    assert across["printing_count"] == 2


def test_owned_across_printings_does_not_merge_distinct_un_oracled_cards(
    catalog_conn: sqlite3.Connection,
) -> None:
    """Two different cards both missing an oracle_id stay separate."""
    inventory.create_lot(catalog_conn, scryfall_id="bolt-1", quantity=1)
    inventory.create_lot(catalog_conn, scryfall_id="helix-1", quantity=5)

    across = _across(catalog_conn, "bolt-1")

    assert across["name"] == "Lightning Bolt"
    assert across["total_quantity"] == 1
    assert across["printing_count"] == 1


def test_owned_across_printings_ignores_unowned_printings(
    catalog_conn: sqlite3.Connection,
) -> None:
    """Printings of the card that own nothing are absent from the breakdown."""
    _insert_card(catalog_conn, "bolt-2", "Lightning Bolt", set_code="2x2")
    _set_oracle_id(catalog_conn, "bolt-1", "oracle-bolt")
    _set_oracle_id(catalog_conn, "bolt-2", "oracle-bolt")
    inventory.create_lot(catalog_conn, scryfall_id="bolt-1", quantity=2)

    across = _across(catalog_conn, "bolt-1")

    assert across["printing_count"] == 1
    assert [p["scryfall_id"] for p in across["printings"]] == ["bolt-1"]


def test_owned_across_printings_unowned_card_is_zero(catalog_conn: sqlite3.Connection) -> None:
    across = _across(catalog_conn, "helix-1")
    assert across["total_quantity"] == 0
    assert across["printing_count"] == 0
    assert across["printings"] == []
    assert across["name"] == "Lightning Helix"


def test_owned_across_printings_unknown_printing_is_none(
    catalog_conn: sqlite3.Connection,
) -> None:
    assert inventory.owned_across_printings(catalog_conn, "ghost") is None


def test_owned_for_printing_carries_the_across_printings_summary(
    catalog_conn: sqlite3.Connection,
) -> None:
    """The per-printing rollup gains the card-level total, additively."""
    _insert_card(catalog_conn, "bolt-2", "Lightning Bolt", set_code="2x2")
    _set_oracle_id(catalog_conn, "bolt-1", "oracle-bolt")
    _set_oracle_id(catalog_conn, "bolt-2", "oracle-bolt")
    inventory.create_lot(catalog_conn, scryfall_id="bolt-1", quantity=1)
    inventory.create_lot(catalog_conn, scryfall_id="bolt-2", quantity=2)

    owned = inventory.owned_for_printing(catalog_conn, "bolt-1")

    assert owned["total_quantity"] == 1  # this printing only, unchanged
    assert owned["across_printings"]["total_quantity"] == 3
    assert owned["across_printings"]["printing_count"] == 2


def test_owned_across_printings_orders_collector_numbers_numerically(
    catalog_conn: sqlite3.Connection,
) -> None:
    """Collector number is TEXT, so a plain sort would read 10 as before 2."""
    for scryfall_id, number in (("bolt-a", "10"), ("bolt-b", "2"), ("bolt-c", "117")):
        _insert_card(
            catalog_conn, scryfall_id, "Lightning Bolt", set_code="2x2", collector_number=number
        )
        _set_oracle_id(catalog_conn, scryfall_id, "oracle-bolt")
        inventory.create_lot(catalog_conn, scryfall_id=scryfall_id)

    across = _across(catalog_conn, "bolt-a")

    assert [p["collector_number"] for p in across["printings"]] == ["2", "10", "117"]


def test_owned_across_printings_gives_the_same_answer_from_any_folio(
    catalog_conn: sqlite3.Connection,
) -> None:
    """The card total must not depend on which printing you asked from.

    A printing with no ``oracle_id`` is its own group. Grouping it with an
    oracled same-name sibling reads as helpful but cannot be made transitive:
    with A (oracle X), B (no oracle) and C (oracle Y) all sharing a name, A
    would see A+B, C would see C+B, and B would see all three. Card identity is
    therefore the ``oracle_id`` when there is one and the name only when there
    is not, which is an equivalence and so answers the same from every side.
    """
    printings = (("bolt-x", "oracle-x"), ("bolt-null", None), ("bolt-y", "oracle-y"))
    for scryfall_id, oracle in printings:
        _insert_card(catalog_conn, scryfall_id, "Lightning Bolt", set_code="2x2")
        _set_oracle_id(catalog_conn, scryfall_id, oracle)
        inventory.create_lot(catalog_conn, scryfall_id=scryfall_id, quantity=1)

    from_x = _across(catalog_conn, "bolt-x")
    from_null = _across(catalog_conn, "bolt-null")
    from_y = _across(catalog_conn, "bolt-y")

    # Each is its own card: three names collide, three oracle identities do not.
    assert from_x["total_quantity"] == 1
    assert from_null["total_quantity"] == 1
    assert from_y["total_quantity"] == 1
    assert [p["scryfall_id"] for p in from_x["printings"]] == ["bolt-x"]
    assert [p["scryfall_id"] for p in from_null["printings"]] == ["bolt-null"]
    assert [p["scryfall_id"] for p in from_y["printings"]] == ["bolt-y"]


def test_owned_across_printings_name_fallback_ignores_oracled_rows(
    catalog_conn: sqlite3.Connection,
) -> None:
    """The name fallback groups un-oracled rows only, never oracled ones.

    Otherwise the fallback reaches across into a real card's group and reports a
    total that printing's own folio would never agree with.
    """
    _insert_card(catalog_conn, "bolt-2", "Lightning Bolt", set_code="2x2")
    _set_oracle_id(catalog_conn, "bolt-2", "oracle-bolt")
    inventory.create_lot(catalog_conn, scryfall_id="bolt-1", quantity=1)  # oracle_id NULL
    inventory.create_lot(catalog_conn, scryfall_id="bolt-2", quantity=9)

    across = _across(catalog_conn, "bolt-1")

    assert across["grouping"] == "name"
    assert across["total_quantity"] == 1
    assert [p["scryfall_id"] for p in across["printings"]] == ["bolt-1"]


# --- reservations on reads (VEG-224) ---------------------------------------


def _claim(
    conn: sqlite3.Connection,
    scryfall_id: str,
    quantity: int,
    *,
    finish: str = "nonfoil",
    board: str = "main",
    claims: bool = True,
) -> None:
    """Slot copies into a fresh Tome with raw inserts (no dependency on decks)."""
    cur = conn.execute(
        "INSERT INTO decks (name, claims_cards) VALUES (?, ?)", ("Tome", int(claims))
    )
    conn.execute(
        "INSERT INTO deck_cards (deck_id, scryfall_id, finish, board, quantity) "
        "VALUES (?, ?, ?, ?, ?)",
        (cur.lastrowid, scryfall_id, finish, board, quantity),
    )
    conn.commit()


def test_lot_carries_its_folio_reservation(catalog_conn: sqlite3.Connection) -> None:
    first = inventory.create_lot(catalog_conn, scryfall_id="bolt-1", quantity=2)
    inventory.create_lot(catalog_conn, scryfall_id="bolt-1", quantity=1)
    foil = inventory.create_lot(catalog_conn, scryfall_id="bolt-1", finish="foil")
    _claim(catalog_conn, "bolt-1", 2)
    _claim(catalog_conn, "bolt-1", 5, board="maybeboard")
    _claim(catalog_conn, "bolt-1", 5, claims=False)

    lot = inventory.get_lot(catalog_conn, first["id"])
    assert lot is not None
    assert lot["folio"] == {"owned": 3, "reserved": 2, "available": 1}
    listed = {row["id"]: row for row in inventory.list_lots(catalog_conn)[0]}
    assert listed[first["id"]]["folio"] == {"owned": 3, "reserved": 2, "available": 1}
    assert listed[foil["id"]]["folio"] == {"owned": 1, "reserved": 0, "available": 1}


def test_lot_folio_available_floors_at_zero(catalog_conn: sqlite3.Connection) -> None:
    lot = inventory.create_lot(catalog_conn, scryfall_id="bolt-1")
    _claim(catalog_conn, "bolt-1", 3)
    fetched = inventory.get_lot(catalog_conn, lot["id"])
    assert fetched is not None
    assert fetched["folio"] == {"owned": 1, "reserved": 3, "available": 0}


def test_owned_for_printing_carries_reservations_per_finish(
    catalog_conn: sqlite3.Connection,
) -> None:
    inventory.create_lot(catalog_conn, scryfall_id="bolt-1", quantity=3)
    inventory.create_lot(catalog_conn, scryfall_id="bolt-1", finish="foil")
    _claim(catalog_conn, "bolt-1", 2)
    _claim(catalog_conn, "bolt-1", 1, finish="etched")  # claimed but unowned

    owned = inventory.owned_for_printing(catalog_conn, "bolt-1")

    assert owned["reservations"] == [
        {"finish": "etched", "owned": 0, "reserved": 1, "available": 0},
        {"finish": "foil", "owned": 1, "reserved": 0, "available": 1},
        {"finish": "nonfoil", "owned": 3, "reserved": 2, "available": 1},
    ]


def test_owned_for_printing_unowned_unclaimed_has_no_reservations(
    catalog_conn: sqlite3.Connection,
) -> None:
    assert inventory.owned_for_printing(catalog_conn, "helix-1")["reservations"] == []


def test_owned_across_printings_carries_reserved_and_available(
    catalog_conn: sqlite3.Connection,
) -> None:
    _insert_card(catalog_conn, "bolt-2", "Lightning Bolt", set_code="2x2")
    _set_oracle_id(catalog_conn, "bolt-1", "oracle-bolt")
    _set_oracle_id(catalog_conn, "bolt-2", "oracle-bolt")
    inventory.create_lot(catalog_conn, scryfall_id="bolt-1", quantity=3)
    inventory.create_lot(catalog_conn, scryfall_id="bolt-1", finish="foil")
    inventory.create_lot(catalog_conn, scryfall_id="bolt-2", quantity=1)
    _claim(catalog_conn, "bolt-1", 2)
    _claim(catalog_conn, "bolt-1", 1, finish="foil")
    _claim(catalog_conn, "bolt-2", 4)

    by_id = {p["scryfall_id"]: p for p in _across(catalog_conn, "bolt-1")["printings"]}

    assert (by_id["bolt-1"]["quantity"], by_id["bolt-1"]["reserved"]) == (4, 3)
    assert by_id["bolt-1"]["available"] == 1
    # Reserved counts only owned copies: 4 claimed, 1 owned.
    assert (by_id["bolt-2"]["quantity"], by_id["bolt-2"]["reserved"]) == (1, 1)
    assert by_id["bolt-2"]["available"] == 0


def test_reservations_ignore_maybeboard_and_brew_claims_on_unowned_finishes(
    catalog_conn: sqlite3.Connection,
) -> None:
    """Maybeboard and non-claiming rows never surface a reservation for an unowned finish."""
    inventory.create_lot(catalog_conn, scryfall_id="bolt-1")
    _claim(catalog_conn, "bolt-1", 1, finish="etched", board="maybeboard")
    _claim(catalog_conn, "bolt-1", 1, finish="etched", claims=False)

    finishes = [
        r["finish"] for r in inventory.owned_for_printing(catalog_conn, "bolt-1")["reservations"]
    ]

    assert "etched" not in finishes
    assert "nonfoil" in finishes


def test_owned_across_printings_ignores_claims_on_unowned_finishes(
    catalog_conn: sqlite3.Connection,
) -> None:
    """A claim on a foil the user doesn't own reserves none of their nonfoils."""
    inventory.create_lot(catalog_conn, scryfall_id="bolt-1", quantity=4)
    _claim(catalog_conn, "bolt-1", 2, finish="foil")

    (printing,) = _across(catalog_conn, "bolt-1")["printings"]

    assert (printing["quantity"], printing["reserved"], printing["available"]) == (4, 0, 4)


def test_owned_across_printings_counts_claims_on_owned_finishes(
    catalog_conn: sqlite3.Connection,
) -> None:
    inventory.create_lot(catalog_conn, scryfall_id="bolt-1", quantity=4)
    _claim(catalog_conn, "bolt-1", 2)

    (printing,) = _across(catalog_conn, "bolt-1")["printings"]

    assert (printing["quantity"], printing["reserved"], printing["available"]) == (4, 2, 2)


# --- search_folios (VEG-227) -----------------------------------------------


@pytest.fixture
def search_conn(catalog_conn: sqlite3.Connection) -> sqlite3.Connection:
    """The catalog plus colored, typed printings and lots spread over nine folios.

    Lot ids follow insertion order, so ``added`` sorts are predictable. Valki has
    no top-level colors: Scryfall puts an MDFC's colors on its faces only.
    """
    conn = catalog_conn
    conn.execute(
        "UPDATE cards SET colors = '[\"R\"]', color_identity = '[\"R\"]', "
        "type_line = 'Instant' WHERE scryfall_id = 'bolt-1'"
    )
    conn.execute(
        'UPDATE cards SET colors = \'["R","W"]\', color_identity = \'["R","W"]\', '
        "type_line = 'Instant' WHERE scryfall_id = 'helix-1'"
    )
    _insert_card(
        conn,
        "counter-1",
        "Counterspell",
        set_code="lea",
        collector_number="54",
        colors='["U"]',
        color_identity='["U"]',
        type_line="Instant",
    )
    _insert_card(
        conn,
        "izzet-1",
        "Izzet Charm",
        set_code="rtr",
        collector_number="10",
        colors='["U","R"]',
        color_identity='["U","R"]',
        type_line="Instant",
    )
    _insert_card(
        conn,
        "sphere-1",
        "Detention Sphere",
        set_code="rtr",
        collector_number="2",
        colors='["W","U"]',
        color_identity='["W","U"]',
        type_line="Enchantment",
    )
    _insert_card(
        conn,
        "sol-1",
        "Sol Ring",
        set_code="lea",
        collector_number="270",
        colors="[]",
        color_identity="[]",
        type_line="Artifact",
    )
    _insert_card(
        conn,
        "valki-1",
        "Valki, God of Lies // Tibalt, Cosmic Impostor",
        set_code="khm",
        collector_number="114",
        layout="modal_dfc",
        color_identity='["B","R"]',
        type_line="Legendary Creature — God // Legendary Planeswalker — Tibalt",
    )
    conn.executemany(
        "INSERT INTO card_faces (scryfall_id, face_index, name, colors) VALUES (?, ?, ?, ?)",
        [
            ("valki-1", 0, "Valki, God of Lies", '["B"]'),
            ("valki-1", 1, "Tibalt, Cosmic Impostor", '["R"]'),
        ],
    )
    # No colors, identity or faces at all: NULL counts as colorless.
    _insert_card(conn, "coin-1", "Krark's 50% Coin", type_line="Artifact")
    conn.commit()

    lots: list[dict[str, Any]] = [
        {
            "scryfall_id": "bolt-1",
            "quantity": 2,
            "location": "Volume I",
            "tags": ["burn"],
        },
        {"scryfall_id": "bolt-1", "condition": "LP", "tags": ["staple", "burn"]},
        {"scryfall_id": "bolt-1", "finish": "foil", "location": "Vault"},
        {"scryfall_id": "helix-1", "quantity": 3, "condition": "MP", "location": "volume i"},
        {"scryfall_id": "counter-1", "location": "Volume II", "tags": ["staple"]},
        {"scryfall_id": "izzet-1", "quantity": 4, "finish": "etched", "condition": "HP"},
        {"scryfall_id": "sphere-1", "condition": "DMG"},
        {"scryfall_id": "sol-1", "quantity": 5},
        {"scryfall_id": "valki-1", "finish": "foil"},
        {"scryfall_id": "coin-1"},
    ]
    inventory.create_lots(conn, lots)
    return conn


def _search(
    conn: sqlite3.Connection, **kwargs: Any
) -> tuple[list[tuple[str, str]], dict[tuple[str, str], dict[str, Any]], int]:
    """Run a search; return the folio keys in order, rows by key, and the total.

    Filter fields go to :class:`inventory.SearchFilters`; ``sort``, ``order``,
    ``limit`` and ``offset`` go to :func:`inventory.search_folios`.
    """
    paging = {k: kwargs.pop(k) for k in ("sort", "order", "limit", "offset") if k in kwargs}
    results, total = inventory.search_folios(conn, inventory.SearchFilters(**kwargs), **paging)
    keys = [(r["scryfall_id"], r["finish"]) for r in results]
    return keys, dict(zip(keys, results, strict=True)), total


_ALL_FOLIOS = {
    ("bolt-1", "nonfoil"),
    ("bolt-1", "foil"),
    ("helix-1", "nonfoil"),
    ("counter-1", "nonfoil"),
    ("izzet-1", "etched"),
    ("sphere-1", "nonfoil"),
    ("sol-1", "nonfoil"),
    ("valki-1", "foil"),
    ("coin-1", "nonfoil"),
}


def test_search_without_filters_returns_every_folio(search_conn: sqlite3.Connection) -> None:
    keys, rows, total = _search(search_conn)

    assert set(keys) == _ALL_FOLIOS
    assert total == len(_ALL_FOLIOS) == len(keys)
    bolt = rows[("bolt-1", "nonfoil")]
    assert (bolt["quantity"], bolt["lots"]) == (3, 2)
    assert bolt["card"]["name"] == "Lightning Bolt"
    assert bolt["card"]["set_code"] == "lea"
    assert bolt["card"]["image_uris"] == {"normal": "https://img/bolt.jpg"}
    assert "latest_id" not in bolt


def test_search_on_an_empty_inventory_is_empty(catalog_conn: sqlite3.Connection) -> None:
    assert _search(catalog_conn) == ([], {}, 0)


def test_search_by_name_is_a_case_insensitive_substring(search_conn: sqlite3.Connection) -> None:
    keys, _, total = _search(search_conn, name="LIGHTNING")

    assert set(keys) == {("bolt-1", "nonfoil"), ("bolt-1", "foil"), ("helix-1", "nonfoil")}
    assert total == 3


def test_search_by_name_treats_like_metacharacters_literally(
    search_conn: sqlite3.Connection,
) -> None:
    # Unescaped, "% c" would match "Izzet Charm" and "s_ell" would match "Counterspell".
    assert _search(search_conn, name="% c")[0] == [("coin-1", "nonfoil")]
    assert _search(search_conn, name="s_ell")[0] == []


def test_search_blank_name_and_type_mean_no_filter(search_conn: sqlite3.Connection) -> None:
    keys, _, _ = _search(search_conn, name="  ", type_line="")

    assert set(keys) == _ALL_FOLIOS


def test_search_by_set_is_any_of_and_case_insensitive(search_conn: sqlite3.Connection) -> None:
    keys, _, _ = _search(search_conn, set_codes=("LEA", "Khm"))

    assert set(keys) == {
        ("bolt-1", "nonfoil"),
        ("bolt-1", "foil"),
        ("counter-1", "nonfoil"),
        ("sol-1", "nonfoil"),
        ("valki-1", "foil"),
    }


def test_search_by_colors_is_any_of(search_conn: sqlite3.Connection) -> None:
    keys, _, _ = _search(search_conn, colors=("U",))
    assert set(keys) == {("counter-1", "nonfoil"), ("izzet-1", "etched"), ("sphere-1", "nonfoil")}

    keys, _, _ = _search(search_conn, colors=("W", "B"))
    assert set(keys) == {("helix-1", "nonfoil"), ("sphere-1", "nonfoil"), ("valki-1", "foil")}


def test_search_by_colors_reads_card_faces(search_conn: sqlite3.Connection) -> None:
    """Valki's colors live only on its faces, and it still matches B."""
    keys, _, _ = _search(search_conn, colors=("B",))

    assert keys == [("valki-1", "foil")]


def test_search_colorless_matches_empty_and_null_colors(search_conn: sqlite3.Connection) -> None:
    """C matches Sol Ring ([]) and the coin (NULL), never Valki, whose faces have colors."""
    keys, _, _ = _search(search_conn, colors=("C",))
    assert set(keys) == {("sol-1", "nonfoil"), ("coin-1", "nonfoil")}

    keys, _, _ = _search(search_conn, colors=("C", "B"))
    assert set(keys) == {("sol-1", "nonfoil"), ("coin-1", "nonfoil"), ("valki-1", "foil")}


def test_search_by_color_identity_is_within(search_conn: sqlite3.Connection) -> None:
    keys, _, _ = _search(search_conn, color_identity=("U", "R"))

    # Mono-R, mono-U, UR and colorless; not RW, WU, or BR.
    assert set(keys) == {
        ("bolt-1", "nonfoil"),
        ("bolt-1", "foil"),
        ("counter-1", "nonfoil"),
        ("izzet-1", "etched"),
        ("sol-1", "nonfoil"),
        ("coin-1", "nonfoil"),
    }


def test_search_color_identity_colorless_alone_matches_only_colorless(
    search_conn: sqlite3.Connection,
) -> None:
    keys, _, _ = _search(search_conn, color_identity=("C",))

    assert set(keys) == {("sol-1", "nonfoil"), ("coin-1", "nonfoil")}


def test_search_color_identity_falls_back_to_colors_when_null(
    search_conn: sqlite3.Connection,
) -> None:
    """A hand-seeded card with no identity is judged by its colors, not as colorless."""
    _insert_card(search_conn, "edgar-1", "Edgar, Charmed Groom", colors='["B","R","W"]')
    search_conn.commit()
    inventory.create_lot(search_conn, scryfall_id="edgar-1")

    assert ("edgar-1", "nonfoil") not in _search(search_conn, color_identity=("U", "R"))[0]
    assert ("edgar-1", "nonfoil") in _search(search_conn, color_identity=("W", "B", "R"))[0]


def test_search_by_type_matches_either_face(search_conn: sqlite3.Connection) -> None:
    assert _search(search_conn, type_line="planeswalker")[0] == [("valki-1", "foil")]
    assert _search(search_conn, type_line="GOD // LEGENDARY")[0] == [("valki-1", "foil")]
    keys, _, _ = _search(search_conn, type_line="instant")
    assert len(keys) == 5


def test_search_by_tag_selects_the_folio_and_keeps_whole_folio_totals(
    search_conn: sqlite3.Connection,
) -> None:
    keys, rows, _ = _search(search_conn, tags=("staple",))

    assert set(keys) == {("bolt-1", "nonfoil"), ("counter-1", "nonfoil")}
    # Only the LP lot carries "staple", but the folio counts both lots.
    bolt = rows[("bolt-1", "nonfoil")]
    assert (bolt["quantity"], bolt["lots"]) == (3, 2)
    assert bolt["conditions"] == ["LP", "NM"]


def test_search_by_location_is_any_of_and_case_insensitive(
    search_conn: sqlite3.Connection,
) -> None:
    keys, _, _ = _search(search_conn, locations=("VOLUME I", "vault"))

    assert set(keys) == {("bolt-1", "nonfoil"), ("bolt-1", "foil"), ("helix-1", "nonfoil")}


def test_search_lists_conditions_locations_and_tags_sorted_and_distinct(
    search_conn: sqlite3.Connection,
) -> None:
    _, rows, _ = _search(search_conn)

    bolt = rows[("bolt-1", "nonfoil")]
    assert bolt["conditions"] == ["LP", "NM"]
    # The LP lot has no location; NULL is left out.
    assert bolt["locations"] == ["Volume I"]
    assert bolt["tags"] == ["burn", "staple"]
    sol = rows[("sol-1", "nonfoil")]
    assert (sol["conditions"], sol["locations"], sol["tags"]) == (["NM"], [], [])


def test_search_by_finish_and_condition_is_any_of(search_conn: sqlite3.Connection) -> None:
    keys, _, _ = _search(search_conn, finishes=("foil", "etched"))
    assert set(keys) == {("bolt-1", "foil"), ("izzet-1", "etched"), ("valki-1", "foil")}

    keys, _, _ = _search(search_conn, conditions=("LP", "DMG"))
    assert set(keys) == {("bolt-1", "nonfoil"), ("sphere-1", "nonfoil")}


def test_search_combines_facets_with_and(search_conn: sqlite3.Connection) -> None:
    assert _search(search_conn, name="lightning", finishes=("foil",))[0] == [("bolt-1", "foil")]
    assert _search(search_conn, colors=("R",), set_codes=("tst",))[0] == [("helix-1", "nonfoil")]


_ADDED_DESC = [
    ("coin-1", "nonfoil"),
    ("valki-1", "foil"),
    ("sol-1", "nonfoil"),
    ("sphere-1", "nonfoil"),
    ("izzet-1", "etched"),
    ("counter-1", "nonfoil"),
    ("helix-1", "nonfoil"),
    ("bolt-1", "foil"),
    ("bolt-1", "nonfoil"),
]


def test_search_sorts_by_added_newest_first_by_default(search_conn: sqlite3.Connection) -> None:
    """Added is the folio's newest lot id, so bolt nonfoil (lots 1 and 2) is oldest."""
    assert _search(search_conn)[0] == _ADDED_DESC
    assert _search(search_conn, sort="added", order="desc")[0] == _ADDED_DESC
    assert _search(search_conn, sort="added", order="asc")[0] == _ADDED_DESC[::-1]


def test_search_sorts_by_name_ascending_by_default(search_conn: sqlite3.Connection) -> None:
    ascending = [
        ("counter-1", "nonfoil"),
        ("sphere-1", "nonfoil"),
        ("izzet-1", "etched"),
        ("coin-1", "nonfoil"),
        ("bolt-1", "foil"),
        ("bolt-1", "nonfoil"),
        ("helix-1", "nonfoil"),
        ("sol-1", "nonfoil"),
        ("valki-1", "foil"),
    ]
    assert _search(search_conn, sort="name")[0] == ascending
    assert _search(search_conn, sort="name", order="asc")[0] == ascending
    # The tiebreak stays ascending, so the two Bolt folios keep their order.
    descending = [
        ("valki-1", "foil"),
        ("sol-1", "nonfoil"),
        ("helix-1", "nonfoil"),
        ("bolt-1", "foil"),
        ("bolt-1", "nonfoil"),
        ("coin-1", "nonfoil"),
        ("izzet-1", "etched"),
        ("sphere-1", "nonfoil"),
        ("counter-1", "nonfoil"),
    ]
    assert _search(search_conn, sort="name", order="desc")[0] == descending


def test_search_name_sort_ignores_case(search_conn: sqlite3.Connection) -> None:
    _insert_card(search_conn, "lower-1", "aether vial")
    search_conn.commit()
    inventory.create_lot(search_conn, scryfall_id="lower-1")

    assert _search(search_conn, sort="name")[0][0] == ("lower-1", "nonfoil")


def test_search_sorts_by_set_with_numeric_collector_numbers(
    search_conn: sqlite3.Connection,
) -> None:
    ascending = [
        ("valki-1", "foil"),
        ("counter-1", "nonfoil"),
        ("bolt-1", "foil"),
        ("bolt-1", "nonfoil"),
        ("sol-1", "nonfoil"),
        ("sphere-1", "nonfoil"),
        ("izzet-1", "etched"),
        ("coin-1", "nonfoil"),
        ("helix-1", "nonfoil"),
    ]
    # 54 < 161 < 270 and 2 < 10, which a text sort would get wrong.
    assert _search(search_conn, sort="set")[0] == ascending
    assert _search(search_conn, sort="set", order="asc")[0] == ascending
    keys, _, _ = _search(search_conn, sort="set", order="desc")
    # Coin and Helix tie on set and number; the ascending tiebreak puts Coin first.
    assert keys[:4] == [
        ("coin-1", "nonfoil"),
        ("helix-1", "nonfoil"),
        ("izzet-1", "etched"),
        ("sphere-1", "nonfoil"),
    ]


def test_search_sorts_by_quantity_largest_first_by_default(
    search_conn: sqlite3.Connection,
) -> None:
    descending = [
        ("sol-1", "nonfoil"),
        ("izzet-1", "etched"),
        ("bolt-1", "nonfoil"),
        ("helix-1", "nonfoil"),
        ("bolt-1", "foil"),
        ("coin-1", "nonfoil"),
        ("counter-1", "nonfoil"),
        ("sphere-1", "nonfoil"),
        ("valki-1", "foil"),
    ]
    assert _search(search_conn, sort="quantity")[0] == descending
    assert _search(search_conn, sort="quantity", order="desc")[0] == descending
    ascending = [
        ("bolt-1", "foil"),
        ("coin-1", "nonfoil"),
        ("counter-1", "nonfoil"),
        ("sphere-1", "nonfoil"),
        ("valki-1", "foil"),
        ("bolt-1", "nonfoil"),
        ("helix-1", "nonfoil"),
        ("izzet-1", "etched"),
        ("sol-1", "nonfoil"),
    ]
    assert _search(search_conn, sort="quantity", order="asc")[0] == ascending


def test_search_reports_reserved_and_available_per_folio(
    search_conn: sqlite3.Connection,
) -> None:
    _claim(search_conn, "bolt-1", 2)
    _claim(search_conn, "bolt-1", 3, finish="foil")
    _claim(search_conn, "bolt-1", 5, board="maybeboard")
    _claim(search_conn, "bolt-1", 5, claims=False)

    _, rows, _ = _search(search_conn, locations=("Volume I", "Vault"))

    nonfoil, foil = rows[("bolt-1", "nonfoil")], rows[("bolt-1", "foil")]
    # Totals cover the whole folio, including the lot with no location.
    assert (nonfoil["quantity"], nonfoil["reserved"], nonfoil["available"]) == (3, 2, 1)
    # Three claimed against one owned: available floors at zero.
    assert (foil["quantity"], foil["reserved"], foil["available"]) == (1, 3, 0)
    assert rows[("helix-1", "nonfoil")]["reserved"] == 0


def test_search_paginates_and_total_ignores_the_page(search_conn: sqlite3.Connection) -> None:
    keys, _, total = _search(search_conn, limit=2, offset=1)

    assert keys == _ADDED_DESC[1:3]
    assert total == len(_ADDED_DESC)
    keys, _, total = _search(search_conn, finishes=("foil",), limit=1, offset=5)
    assert (keys, total) == ([], 2)


def test_search_added_sort_uses_the_newest_lot_in_the_folio(
    search_conn: sqlite3.Connection,
) -> None:
    oldest = _search(search_conn)[0][-1]
    assert oldest == ("bolt-1", "nonfoil")

    inventory.create_lot(search_conn, scryfall_id=oldest[0], finish=oldest[1])

    assert _search(search_conn)[0][0] == oldest


def test_search_color_identity_prefers_identity_over_colors(
    search_conn: sqlite3.Connection,
) -> None:
    _insert_card(
        search_conn,
        "signet-1",
        "Rakdos Signet",
        colors="[]",
        color_identity='["B","R"]',
    )
    search_conn.commit()
    inventory.create_lot(search_conn, scryfall_id="signet-1")

    assert ("signet-1", "nonfoil") not in _search(search_conn, color_identity=("U",))[0]
    assert ("signet-1", "nonfoil") in _search(search_conn, color_identity=("B", "R"))[0]


def test_search_tags_are_per_finish(search_conn: sqlite3.Connection) -> None:
    _, rows, _ = _search(search_conn)

    assert rows[("bolt-1", "foil")]["tags"] == []
    assert rows[("bolt-1", "nonfoil")]["tags"] == ["burn", "staple"]


def test_search_rejects_unknown_sort_and_order(search_conn: sqlite3.Connection) -> None:
    filters = inventory.SearchFilters()
    with pytest.raises(ValueError):
        inventory.search_folios(search_conn, filters, sort="price")  # type: ignore[arg-type]
    with pytest.raises(ValueError):
        inventory.search_folios(search_conn, filters, order="sideways")  # type: ignore[arg-type]
