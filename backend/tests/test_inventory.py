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
