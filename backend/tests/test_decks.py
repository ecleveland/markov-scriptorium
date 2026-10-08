"""Tests for the Tome read/write layer (VEG-223, builds on ADR 0018).

Seed a fresh tmp catalog with a few printings, then exercise the functions over
the ``decks`` and ``deck_cards`` tables: create, list, read, update, and delete a
Tome, add, amend, and remove slots, and the owned-versus-needed breakdown.

Every write must set ``decks.updated_at`` in the same transaction, because the
schema has no trigger to do it (migration 0006). Those tests first push the
stamp back to a fixed past value, then write, then check that it moved. That
avoids sleeping for a clock tick.
"""

from __future__ import annotations

import re
import sqlite3
from collections.abc import Iterator
from contextlib import closing
from pathlib import Path
from typing import Any, NamedTuple

import pytest

from scriptorium import db, decks, inventory
from scriptorium.migrations import apply_migrations

_REQUIRED_DEFAULTS = {
    "set_code": "tst",
    "set_name": "Test Set",
    "collector_number": "1",
    "rarity": "common",
    "lang": "en",
    "layout": "normal",
}

_ISO_UTC = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
_PAST = "2000-01-01T00:00:00Z"


def _insert_card(
    conn: sqlite3.Connection, scryfall_id: str, name: str, **overrides: object
) -> None:
    cols = {"scryfall_id": scryfall_id, "name": name, **_REQUIRED_DEFAULTS, **overrides}
    placeholders = ", ".join("?" for _ in cols)
    conn.execute(
        f"INSERT INTO cards ({', '.join(cols)}) VALUES ({placeholders})",
        tuple(cols.values()),
    )


def _insert_row(conn: sqlite3.Connection, table: str, **cols: object) -> int:
    """Insert a raw row into ``table`` (defaults fill the rest); return its rowid."""
    placeholders = ", ".join("?" for _ in cols)
    cur = conn.execute(
        f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({placeholders})",
        tuple(cols.values()),
    )
    assert cur.lastrowid is not None
    return cur.lastrowid


@pytest.fixture
def catalog_conn(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[sqlite3.Connection]:
    monkeypatch.setenv("SCRIPTORIUM_DB_PATH", str(tmp_path / "catalog.db"))
    conn = db.connect()
    apply_migrations(conn)
    _insert_card(
        conn,
        "edgar-1",
        "Edgar Markov",
        set_code="c17",
        set_name="Commander 2017",
        collector_number="36",
        image_uris='{"normal":"https://img/edgar.jpg"}',
    )
    _insert_card(conn, "bolt-1", "Lightning Bolt")
    _insert_card(conn, "ghast-1", "Bloodghast")
    _insert_card(conn, "lurrus-1", "Lurrus of the Dream-Den")
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


def _make_stale(conn: sqlite3.Connection, deck_id: int) -> None:
    conn.execute("UPDATE decks SET updated_at = ? WHERE id = ?", (_PAST, deck_id))
    conn.commit()


def _assert_touched(conn: sqlite3.Connection, deck_id: int) -> None:
    stamp = conn.execute("SELECT updated_at FROM decks WHERE id = ?", (deck_id,)).fetchone()[0]
    assert stamp != _PAST
    assert _ISO_UTC.match(stamp)


# --- create / list / get ----------------------------------------------------


def test_create_deck_returns_defaults_and_timestamps(catalog_conn: sqlite3.Connection) -> None:
    deck = decks.create_deck(catalog_conn, name="Edgar's Court")
    assert deck["id"] >= 1
    assert deck["name"] == "Edgar's Court"
    assert (deck["format"], deck["status"], deck["claims_cards"]) == (None, "in_progress", True)
    assert (deck["notes"], deck["changelog"]) == (None, None)
    assert _ISO_UTC.match(deck["created_at"])
    assert _ISO_UTC.match(deck["updated_at"])


def test_create_deck_persists_every_field(catalog_conn: sqlite3.Connection) -> None:
    deck = decks.create_deck(
        catalog_conn,
        name="Brew",
        format="commander",
        status="playtest",
        claims_cards=False,
        notes="tokens matter",
        changelog="v1",
    )
    assert deck["format"] == "commander"
    assert deck["status"] == "playtest"
    assert deck["claims_cards"] is False
    assert (deck["notes"], deck["changelog"]) == ("tokens matter", "v1")
    stored = catalog_conn.execute(
        "SELECT claims_cards FROM decks WHERE id = ?", (deck["id"],)
    ).fetchone()[0]
    assert stored == 0


def test_create_deck_database_error_rolls_back(catalog_conn: sqlite3.Connection) -> None:
    """A name the CHECK refuses raises and leaves no transaction open."""
    with pytest.raises(sqlite3.IntegrityError):
        decks.create_deck(catalog_conn, name="   ")
    assert not catalog_conn.in_transaction


def test_list_decks_newest_first_with_card_count(catalog_conn: sqlite3.Connection) -> None:
    older = _deck(catalog_conn, "Older")
    newer = _deck(catalog_conn, "Newer")
    _slot(catalog_conn, older, "bolt-1", quantity=4)
    _slot(catalog_conn, older, "ghast-1", board="sideboard", quantity=2)
    _slot(catalog_conn, older, "edgar-1", board="commander")
    _slot(catalog_conn, older, "lurrus-1", board="maybeboard", quantity=3)

    listed = decks.list_decks(catalog_conn)

    assert [d["id"] for d in listed] == [newer, older]
    counts = {d["id"]: d["card_count"] for d in listed}
    assert counts == {older: 7, newer: 0}
    assert listed[0]["claims_cards"] is True


def test_get_deck_returns_slots_ordered_by_board_then_name(
    catalog_conn: sqlite3.Connection,
) -> None:
    deck_id = _deck(catalog_conn)
    _slot(catalog_conn, deck_id, "ghast-1", board="maybeboard")
    _slot(catalog_conn, deck_id, "lurrus-1", board="sideboard")
    _slot(catalog_conn, deck_id, "bolt-1", board="main")
    _slot(catalog_conn, deck_id, "ghast-1", board="main")
    _slot(catalog_conn, deck_id, "lurrus-1", board="companion")
    _slot(catalog_conn, deck_id, "edgar-1", board="commander")

    deck = decks.get_deck(catalog_conn, deck_id)

    assert deck is not None
    assert deck["name"] == "Edgar's Court"
    order = [(c["board"], c["card"]["name"]) for c in deck["cards"]]
    assert order == [
        ("commander", "Edgar Markov"),
        ("companion", "Lurrus of the Dream-Den"),
        ("main", "Bloodghast"),
        ("main", "Lightning Bolt"),
        ("sideboard", "Lurrus of the Dream-Den"),
        ("maybeboard", "Bloodghast"),
    ]
    commander = deck["cards"][0]
    assert commander["deck_id"] == deck_id
    assert commander["scryfall_id"] == "edgar-1"
    assert (commander["finish"], commander["quantity"]) == ("nonfoil", 1)
    assert commander["card"]["set_code"] == "c17"
    assert commander["card"]["collector_number"] == "36"
    assert commander["card"]["image_uris"] == {"normal": "https://img/edgar.jpg"}


def test_get_deck_missing_returns_none(catalog_conn: sqlite3.Connection) -> None:
    assert decks.get_deck(catalog_conn, 999) is None


# --- update / delete deck ---------------------------------------------------


def test_update_deck_changes_each_field(catalog_conn: sqlite3.Connection) -> None:
    deck_id = _deck(catalog_conn)
    updated = decks.update_deck(
        catalog_conn,
        deck_id,
        {
            "name": "Edgar's Court, Second Edition",
            "format": "commander",
            "status": "active",
            "claims_cards": False,
            "notes": "sleeved in black",
            "changelog": "cut Sol Ring",
        },
    )
    assert updated is not None
    assert updated["name"] == "Edgar's Court, Second Edition"
    assert updated["format"] == "commander"
    assert updated["status"] == "active"
    assert updated["claims_cards"] is False
    assert updated["notes"] == "sleeved in black"
    assert updated["changelog"] == "cut Sol Ring"


def test_update_deck_null_clears_optional_fields(catalog_conn: sqlite3.Connection) -> None:
    deck_id = _deck(catalog_conn, format="modern", notes="n", changelog="c")
    updated = decks.update_deck(
        catalog_conn, deck_id, {"format": None, "notes": None, "changelog": None}
    )
    assert updated is not None
    assert (updated["format"], updated["notes"], updated["changelog"]) == (None, None, None)


def test_update_deck_ignores_keys_outside_the_allowlist(catalog_conn: sqlite3.Connection) -> None:
    deck_id = _deck(catalog_conn)
    updated = decks.update_deck(catalog_conn, deck_id, {"id": 77, "created_at": _PAST})
    assert updated is not None
    assert updated["id"] == deck_id
    assert updated["created_at"] != _PAST


def test_update_deck_database_error_rolls_back(catalog_conn: sqlite3.Connection) -> None:
    deck_id = _deck(catalog_conn)
    with pytest.raises(sqlite3.IntegrityError):
        decks.update_deck(catalog_conn, deck_id, {"status": "retired"})
    assert not catalog_conn.in_transaction


def test_update_deck_missing_returns_none(catalog_conn: sqlite3.Connection) -> None:
    assert decks.update_deck(catalog_conn, 999, {"name": "Ghost"}) is None
    assert decks.update_deck(catalog_conn, 999, {}) is None


def test_update_deck_bumps_updated_at(catalog_conn: sqlite3.Connection) -> None:
    deck_id = _deck(catalog_conn)
    _make_stale(catalog_conn, deck_id)
    decks.update_deck(catalog_conn, deck_id, {"notes": "touched"})
    _assert_touched(catalog_conn, deck_id)


def test_delete_deck_cascades_slots_and_keeps_inventory(catalog_conn: sqlite3.Connection) -> None:
    deck_id = _deck(catalog_conn)
    _slot(catalog_conn, deck_id, "bolt-1", quantity=2)
    inventory.create_lot(catalog_conn, scryfall_id="bolt-1", quantity=2)

    assert decks.delete_deck(catalog_conn, deck_id) is True

    assert decks.get_deck(catalog_conn, deck_id) is None
    assert catalog_conn.execute("SELECT COUNT(*) FROM deck_cards").fetchone()[0] == 0
    assert catalog_conn.execute("SELECT SUM(quantity) FROM inventory").fetchone()[0] == 2
    assert decks.delete_deck(catalog_conn, deck_id) is False


# --- add slot ---------------------------------------------------------------


def test_add_slot_inserts_enriched_slot(catalog_conn: sqlite3.Connection) -> None:
    deck_id = _deck(catalog_conn)
    slot = _slot(catalog_conn, deck_id, "bolt-1", finish="foil", board="sideboard", quantity=3)
    assert slot["id"] >= 1
    assert slot["deck_id"] == deck_id
    assert (slot["scryfall_id"], slot["finish"], slot["board"], slot["quantity"]) == (
        "bolt-1",
        "foil",
        "sideboard",
        3,
    )
    assert slot["card"]["name"] == "Lightning Bolt"


def test_add_slot_defaults_to_one_nonfoil_main(catalog_conn: sqlite3.Connection) -> None:
    deck_id = _deck(catalog_conn)
    slot = _slot(catalog_conn, deck_id, "bolt-1")
    assert (slot["finish"], slot["board"], slot["quantity"]) == ("nonfoil", "main", 1)


def test_add_slot_again_merges_quantity(catalog_conn: sqlite3.Connection) -> None:
    deck_id = _deck(catalog_conn)
    first = _slot(catalog_conn, deck_id, "bolt-1", quantity=2)
    second = _slot(catalog_conn, deck_id, "bolt-1", quantity=1)
    assert second["id"] == first["id"]
    assert second["quantity"] == 3
    assert catalog_conn.execute("SELECT COUNT(*) FROM deck_cards").fetchone()[0] == 1


def test_add_slot_keeps_other_finish_and_board_separate(catalog_conn: sqlite3.Connection) -> None:
    deck_id = _deck(catalog_conn)
    a = _slot(catalog_conn, deck_id, "bolt-1")
    b = _slot(catalog_conn, deck_id, "bolt-1", finish="foil")
    c = _slot(catalog_conn, deck_id, "bolt-1", board="sideboard")
    assert len({a["id"], b["id"], c["id"]}) == 3


@pytest.mark.parametrize("board", ["commander", "companion"])
def test_add_slot_singleton_already_slotted_raises(
    catalog_conn: sqlite3.Connection, board: str
) -> None:
    deck_id = _deck(catalog_conn)
    first = _slot(catalog_conn, deck_id, "lurrus-1", board=board)
    with pytest.raises(decks.SlotConflictError) as excinfo:
        decks.add_slot(catalog_conn, deck_id, scryfall_id="lurrus-1", board=board)
    assert excinfo.value.existing_slot_id == first["id"]
    quantity = catalog_conn.execute(
        "SELECT quantity FROM deck_cards WHERE id = ?", (first["id"],)
    ).fetchone()[0]
    assert quantity == 1


@pytest.mark.parametrize("board", ["commander", "companion"])
def test_add_slot_singleton_quantity_above_one_raises(
    catalog_conn: sqlite3.Connection, board: str
) -> None:
    deck_id = _deck(catalog_conn)
    with pytest.raises(decks.SlotConflictError) as excinfo:
        decks.add_slot(catalog_conn, deck_id, scryfall_id="lurrus-1", board=board, quantity=2)
    assert excinfo.value.existing_slot_id is None
    assert catalog_conn.execute("SELECT COUNT(*) FROM deck_cards").fetchone()[0] == 0


def test_add_slot_partner_commanders_are_two_slots(catalog_conn: sqlite3.Connection) -> None:
    deck_id = _deck(catalog_conn)
    _slot(catalog_conn, deck_id, "edgar-1", board="commander")
    _slot(catalog_conn, deck_id, "lurrus-1", board="commander")
    deck = decks.get_deck(catalog_conn, deck_id)
    assert deck is not None
    assert [c["board"] for c in deck["cards"]] == ["commander", "commander"]


def test_add_slot_missing_deck_returns_none(catalog_conn: sqlite3.Connection) -> None:
    assert decks.add_slot(catalog_conn, 999, scryfall_id="bolt-1") is None


def test_add_slot_unknown_printing_violates_fk_and_rolls_back(
    catalog_conn: sqlite3.Connection,
) -> None:
    deck_id = _deck(catalog_conn)
    _make_stale(catalog_conn, deck_id)
    with pytest.raises(sqlite3.IntegrityError):
        decks.add_slot(catalog_conn, deck_id, scryfall_id="no-such-card")
    assert not catalog_conn.in_transaction
    stamp = catalog_conn.execute(
        "SELECT updated_at FROM decks WHERE id = ?", (deck_id,)
    ).fetchone()[0]
    assert stamp == _PAST


def test_add_slot_bumps_updated_at(catalog_conn: sqlite3.Connection) -> None:
    deck_id = _deck(catalog_conn)
    _make_stale(catalog_conn, deck_id)
    _slot(catalog_conn, deck_id, "bolt-1")
    _assert_touched(catalog_conn, deck_id)


def test_add_slot_merge_bumps_updated_at(catalog_conn: sqlite3.Connection) -> None:
    deck_id = _deck(catalog_conn)
    _slot(catalog_conn, deck_id, "bolt-1")
    _make_stale(catalog_conn, deck_id)
    _slot(catalog_conn, deck_id, "bolt-1")
    _assert_touched(catalog_conn, deck_id)


# --- update slot ------------------------------------------------------------


def test_update_slot_changes_quantity(catalog_conn: sqlite3.Connection) -> None:
    deck_id = _deck(catalog_conn)
    slot = _slot(catalog_conn, deck_id, "bolt-1")
    updated = decks.update_slot(catalog_conn, deck_id, slot["id"], {"quantity": 4})
    assert updated is not None
    assert updated["quantity"] == 4
    assert updated["card"]["name"] == "Lightning Bolt"


def test_update_slot_swaps_finish_printing_and_board(catalog_conn: sqlite3.Connection) -> None:
    deck_id = _deck(catalog_conn)
    slot = _slot(catalog_conn, deck_id, "bolt-1", quantity=2)
    updated = decks.update_slot(
        catalog_conn,
        deck_id,
        slot["id"],
        {"finish": "foil", "scryfall_id": "ghast-1", "board": "sideboard"},
    )
    assert updated is not None
    assert updated["id"] == slot["id"]
    assert (updated["scryfall_id"], updated["finish"], updated["board"]) == (
        "ghast-1",
        "foil",
        "sideboard",
    )
    assert updated["quantity"] == 2
    assert updated["card"]["name"] == "Bloodghast"


def test_update_slot_onto_existing_tuple_raises(catalog_conn: sqlite3.Connection) -> None:
    deck_id = _deck(catalog_conn)
    foil = _slot(catalog_conn, deck_id, "bolt-1", finish="foil")
    nonfoil = _slot(catalog_conn, deck_id, "bolt-1", finish="nonfoil", quantity=2)
    with pytest.raises(decks.SlotConflictError) as excinfo:
        decks.update_slot(catalog_conn, deck_id, nonfoil["id"], {"finish": "foil"})
    assert excinfo.value.existing_slot_id == foil["id"]
    assert str(foil["id"]) in str(excinfo.value)
    rows = catalog_conn.execute("SELECT finish, quantity FROM deck_cards ORDER BY id").fetchall()
    assert [tuple(r) for r in rows] == [("foil", 1), ("nonfoil", 2)]


def test_update_slot_to_its_own_tuple_is_allowed(catalog_conn: sqlite3.Connection) -> None:
    deck_id = _deck(catalog_conn)
    slot = _slot(catalog_conn, deck_id, "bolt-1")
    updated = decks.update_slot(
        catalog_conn, deck_id, slot["id"], {"finish": "nonfoil", "quantity": 3}
    )
    assert updated is not None
    assert updated["quantity"] == 3


@pytest.mark.parametrize("board", ["commander", "companion"])
def test_update_slot_singleton_quantity_above_one_raises(
    catalog_conn: sqlite3.Connection, board: str
) -> None:
    deck_id = _deck(catalog_conn)
    slot = _slot(catalog_conn, deck_id, "lurrus-1", board=board)
    with pytest.raises(decks.SlotConflictError):
        decks.update_slot(catalog_conn, deck_id, slot["id"], {"quantity": 2})


def test_update_slot_moving_a_playset_to_commander_raises(
    catalog_conn: sqlite3.Connection,
) -> None:
    deck_id = _deck(catalog_conn)
    slot = _slot(catalog_conn, deck_id, "bolt-1", quantity=4)
    with pytest.raises(decks.SlotConflictError):
        decks.update_slot(catalog_conn, deck_id, slot["id"], {"board": "commander"})


def test_update_slot_under_wrong_deck_returns_none(catalog_conn: sqlite3.Connection) -> None:
    deck_id = _deck(catalog_conn)
    other = _deck(catalog_conn, "Other")
    slot = _slot(catalog_conn, deck_id, "bolt-1")
    assert decks.update_slot(catalog_conn, other, slot["id"], {"quantity": 2}) is None
    assert decks.update_slot(catalog_conn, deck_id, 999, {"quantity": 2}) is None


def test_update_slot_empty_is_noop(catalog_conn: sqlite3.Connection) -> None:
    deck_id = _deck(catalog_conn)
    slot = _slot(catalog_conn, deck_id, "bolt-1")
    _make_stale(catalog_conn, deck_id)
    assert decks.update_slot(catalog_conn, deck_id, slot["id"], {}) == slot


def test_update_slot_unknown_printing_violates_fk(catalog_conn: sqlite3.Connection) -> None:
    deck_id = _deck(catalog_conn)
    slot = _slot(catalog_conn, deck_id, "bolt-1")
    with pytest.raises(sqlite3.IntegrityError):
        decks.update_slot(catalog_conn, deck_id, slot["id"], {"scryfall_id": "no-such-card"})
    assert not catalog_conn.in_transaction


def test_update_slot_bumps_updated_at(catalog_conn: sqlite3.Connection) -> None:
    deck_id = _deck(catalog_conn)
    slot = _slot(catalog_conn, deck_id, "bolt-1")
    _make_stale(catalog_conn, deck_id)
    decks.update_slot(catalog_conn, deck_id, slot["id"], {"quantity": 2})
    _assert_touched(catalog_conn, deck_id)


def test_empty_updates_leave_updated_at_alone(catalog_conn: sqlite3.Connection) -> None:
    """An empty deck or slot patch changes nothing, so it must not move the stamp."""
    deck_id = _deck(catalog_conn)
    slot = _slot(catalog_conn, deck_id, "bolt-1")
    _make_stale(catalog_conn, deck_id)
    decks.update_deck(catalog_conn, deck_id, {})
    decks.update_slot(catalog_conn, deck_id, slot["id"], {})
    stamp = catalog_conn.execute(
        "SELECT updated_at FROM decks WHERE id = ?", (deck_id,)
    ).fetchone()[0]
    assert stamp == _PAST


def test_failed_slot_update_leaves_updated_at_alone(catalog_conn: sqlite3.Connection) -> None:
    """A slot update the foreign key refuses rolls back the stamp bump with it."""
    deck_id = _deck(catalog_conn)
    slot = _slot(catalog_conn, deck_id, "bolt-1")
    _make_stale(catalog_conn, deck_id)
    with pytest.raises(sqlite3.IntegrityError):
        decks.update_slot(catalog_conn, deck_id, slot["id"], {"scryfall_id": "no-such-card"})
    stamp = catalog_conn.execute(
        "SELECT updated_at FROM decks WHERE id = ?", (deck_id,)
    ).fetchone()[0]
    assert stamp == _PAST
    assert not catalog_conn.in_transaction


# --- delete slot ------------------------------------------------------------


def test_delete_slot_removes_and_reports(catalog_conn: sqlite3.Connection) -> None:
    deck_id = _deck(catalog_conn)
    other = _deck(catalog_conn, "Other")
    slot = _slot(catalog_conn, deck_id, "bolt-1")
    assert decks.delete_slot(catalog_conn, other, slot["id"]) is False
    assert decks.delete_slot(catalog_conn, deck_id, slot["id"]) is True
    assert decks.delete_slot(catalog_conn, deck_id, slot["id"]) is False
    assert catalog_conn.execute("SELECT COUNT(*) FROM deck_cards").fetchone()[0] == 0


def test_delete_slot_bumps_updated_at(catalog_conn: sqlite3.Connection) -> None:
    deck_id = _deck(catalog_conn)
    slot = _slot(catalog_conn, deck_id, "bolt-1")
    _make_stale(catalog_conn, deck_id)
    decks.delete_slot(catalog_conn, deck_id, slot["id"])
    _assert_touched(catalog_conn, deck_id)


# --- breakdown --------------------------------------------------------------


class Line(NamedTuple):
    """One breakdown line, minus the identifying columns."""

    owned: int
    available: int
    have: int
    needed: int


def _breakdown(conn: sqlite3.Connection, deck_id: int) -> dict[str, Any]:
    result = decks.breakdown(conn, deck_id)
    assert result is not None
    return result


def _lines_by_key(result: dict[str, Any]) -> dict[tuple[str, str, str], Line]:
    lines = {
        (ln["scryfall_id"], ln["finish"], ln["board"]): Line(
            ln["owned"], ln["available"], ln["have"], ln["needed"]
        )
        for ln in result["lines"]
    }
    assert len(lines) == len(result["lines"])
    return lines


def test_breakdown_matches_the_reference_case_table(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Reproduce ``test_schema_decks.test_breakdown_query_owned_vs_needed`` exactly.

    Same fixture, same expected lines, read through the production function
    instead of the reference SQL. The production query scopes its CTEs to the
    Tome's printings, which must not change any number.
    """
    monkeypatch.setenv("SCRIPTORIUM_DB_PATH", str(tmp_path / "reference.db"))
    with closing(db.connect()) as conn:
        apply_migrations(conn)
        for sid, name in [
            ("owned", "Sol Ring"),
            ("partial", "Lightning Bolt"),
            ("unowned", "The One Ring"),
            ("split", "Pyroblast"),
            ("contested", "Swords to Plowshares"),
            ("released", "Brainstorm"),
            ("maybe", "Counterspell"),
            ("foil-only", "Mana Crypt"),
            ("rival-foil", "Dark Ritual"),
            ("both-finishes", "Brainstone"),
            ("ladder", "Edgar Markov"),
            ("lots", "Bloodghast"),
            ("starved", "Demonic Tutor"),
            ("overclaimed", "Rhystic Study"),
        ]:
            _insert_card(conn, sid, name)

        def deck(name: str, **cols: object) -> int:
            return _insert_row(conn, "decks", name=name, **cols)

        def slot(deck_id: int, sid: str, **cols: object) -> None:
            _insert_row(conn, "deck_cards", deck_id=deck_id, scryfall_id=sid, **cols)

        def own(sid: str, quantity: int, **cols: object) -> None:
            _insert_row(conn, "inventory", scryfall_id=sid, quantity=quantity, **cols)

        tome = deck("Tome under test")
        rival = deck("Sleeved rival", claims_cards=1)
        second_rival = deck("Second sleeved rival", claims_cards=1)
        brew = deck("Brew folder", claims_cards=0)
        dreamer = deck("Dreamer", claims_cards=1)

        own("owned", 1)
        slot(tome, "owned", quantity=1)
        own("partial", 2)
        slot(tome, "partial", quantity=4)
        slot(tome, "unowned", quantity=1)

        own("split", 3)
        slot(tome, "split", board="main", quantity=2)
        slot(tome, "split", board="sideboard", quantity=2)

        own("contested", 4)
        slot(tome, "contested", quantity=4)
        slot(rival, "contested", quantity=3)

        own("released", 4)
        slot(tome, "released", quantity=4)
        slot(brew, "released", quantity=4)

        own("maybe", 1)
        slot(tome, "maybe", quantity=1)
        slot(tome, "maybe", board="maybeboard", quantity=1)
        slot(dreamer, "maybe", board="maybeboard", quantity=1)

        own("foil-only", 1, finish="foil")
        slot(tome, "foil-only", finish="nonfoil", quantity=1)

        own("rival-foil", 2, finish="nonfoil")
        own("rival-foil", 1, finish="foil")
        slot(tome, "rival-foil", finish="nonfoil", quantity=2)
        slot(rival, "rival-foil", finish="foil", quantity=1)

        own("both-finishes", 1, finish="nonfoil")
        own("both-finishes", 1, finish="foil")
        slot(tome, "both-finishes", finish="nonfoil", quantity=1)
        slot(tome, "both-finishes", finish="foil", quantity=1)

        own("ladder", 2)
        slot(tome, "ladder", board="sideboard", quantity=2)
        slot(tome, "ladder", board="main", quantity=1)
        slot(tome, "ladder", board="commander", quantity=1)

        own("lots", 1, condition="NM")
        own("lots", 2, condition="LP")
        slot(tome, "lots", quantity=3)

        own("starved", 4)
        slot(tome, "starved", quantity=1)
        slot(rival, "starved", quantity=2)
        slot(second_rival, "starved", quantity=2)

        own("overclaimed", 1)
        slot(tome, "overclaimed", quantity=1)
        slot(rival, "overclaimed", quantity=3)
        conn.commit()

        result = _breakdown(conn, tome)

        slot_count = conn.execute(
            "SELECT COUNT(*) FROM deck_cards WHERE deck_id = ? AND board <> 'maybeboard'",
            (tome,),
        ).fetchone()[0]
        assert len(result["lines"]) == slot_count
        assert _lines_by_key(result) == {
            ("owned", "nonfoil", "main"): Line(owned=1, available=1, have=1, needed=0),
            ("partial", "nonfoil", "main"): Line(owned=2, available=2, have=2, needed=2),
            ("unowned", "nonfoil", "main"): Line(owned=0, available=0, have=0, needed=1),
            ("split", "nonfoil", "main"): Line(owned=3, available=3, have=2, needed=0),
            ("split", "nonfoil", "sideboard"): Line(owned=3, available=3, have=1, needed=1),
            ("contested", "nonfoil", "main"): Line(owned=4, available=1, have=1, needed=3),
            ("released", "nonfoil", "main"): Line(owned=4, available=4, have=4, needed=0),
            ("maybe", "nonfoil", "main"): Line(owned=1, available=1, have=1, needed=0),
            ("foil-only", "nonfoil", "main"): Line(owned=0, available=0, have=0, needed=1),
            ("rival-foil", "nonfoil", "main"): Line(owned=2, available=2, have=2, needed=0),
            ("both-finishes", "nonfoil", "main"): Line(owned=1, available=1, have=1, needed=0),
            ("both-finishes", "foil", "main"): Line(owned=1, available=1, have=1, needed=0),
            ("ladder", "nonfoil", "commander"): Line(owned=2, available=2, have=1, needed=0),
            ("ladder", "nonfoil", "main"): Line(owned=2, available=2, have=1, needed=0),
            ("ladder", "nonfoil", "sideboard"): Line(owned=2, available=2, have=0, needed=2),
            ("lots", "nonfoil", "main"): Line(owned=3, available=3, have=3, needed=0),
            ("starved", "nonfoil", "main"): Line(owned=4, available=0, have=0, needed=1),
            ("overclaimed", "nonfoil", "main"): Line(owned=1, available=0, have=0, needed=1),
        }


def test_breakdown_line_shape_order_and_totals(catalog_conn: sqlite3.Connection) -> None:
    deck_id = _deck(catalog_conn)
    _slot(catalog_conn, deck_id, "bolt-1", quantity=4)
    _slot(catalog_conn, deck_id, "ghast-1", board="sideboard", quantity=2)
    _slot(catalog_conn, deck_id, "edgar-1", board="commander")
    _slot(catalog_conn, deck_id, "lurrus-1", board="maybeboard", quantity=3)
    inventory.create_lot(catalog_conn, scryfall_id="bolt-1", quantity=3)
    inventory.create_lot(catalog_conn, scryfall_id="edgar-1", quantity=1)

    result = _breakdown(catalog_conn, deck_id)

    assert result["deck_id"] == deck_id
    assert [(ln["board"], ln["card"]["name"]) for ln in result["lines"]] == [
        ("commander", "Edgar Markov"),
        ("main", "Lightning Bolt"),
        ("sideboard", "Bloodghast"),
    ]
    commander = result["lines"][0]
    assert set(commander) == {
        "id",
        "board",
        "scryfall_id",
        "finish",
        "quantity",
        "owned",
        "available",
        "have",
        "needed",
        "card",
        "swap_hint",
    }
    assert commander["card"]["image_uris"] == {"normal": "https://img/edgar.jpg"}
    assert result["totals"] == {"cards": 7, "have": 4, "needed": 3}


def test_breakdown_attaches_swap_hint_only_to_needed_lines(
    catalog_conn: sqlite3.Connection,
) -> None:
    _insert_card(catalog_conn, "bolt-2", "Lightning Bolt", set_code="2x2")
    catalog_conn.execute("UPDATE cards SET oracle_id = 'oracle-bolt' WHERE name = 'Lightning Bolt'")
    catalog_conn.commit()
    deck_id = _deck(catalog_conn)
    _slot(catalog_conn, deck_id, "bolt-1", quantity=2)
    _slot(catalog_conn, deck_id, "ghast-1")
    inventory.create_lot(catalog_conn, scryfall_id="bolt-2", quantity=3)
    inventory.create_lot(catalog_conn, scryfall_id="ghast-1", quantity=1)

    lines = {ln["scryfall_id"]: ln for ln in _breakdown(catalog_conn, deck_id)["lines"]}

    assert lines["ghast-1"]["needed"] == 0
    assert lines["ghast-1"]["swap_hint"] is None
    assert lines["bolt-1"]["needed"] == 2
    hint = lines["bolt-1"]["swap_hint"]
    assert hint == inventory.owned_across_printings(catalog_conn, "bolt-1")
    assert hint["total_quantity"] == 3
    assert [p["scryfall_id"] for p in hint["printings"]] == ["bolt-2"]


def test_breakdown_non_claiming_tome_still_sees_rival_claims(
    catalog_conn: sqlite3.Connection,
) -> None:
    """A Tome that holds no claim of its own is still squeezed by claiming rivals."""
    tome = _deck(catalog_conn, "Brew folder", claims_cards=False)
    rival = _deck(catalog_conn, "Sleeved rival")
    inventory.create_lot(catalog_conn, scryfall_id="bolt-1", quantity=4)
    _slot(catalog_conn, tome, "bolt-1", quantity=4)
    _slot(catalog_conn, rival, "bolt-1", quantity=3)

    line = _breakdown(catalog_conn, tome)["lines"][0]

    assert (line["owned"], line["available"], line["have"], line["needed"]) == (4, 1, 1, 3)


def test_breakdown_unowned_card_gets_empty_swap_hint(catalog_conn: sqlite3.Connection) -> None:
    deck_id = _deck(catalog_conn)
    _slot(catalog_conn, deck_id, "bolt-1")

    hint = _breakdown(catalog_conn, deck_id)["lines"][0]["swap_hint"]

    assert isinstance(hint, dict)
    assert hint["total_quantity"] == 0
    assert hint["printings"] == []


def test_breakdown_swap_hint_attaches_per_line_not_per_printing(
    catalog_conn: sqlite3.Connection,
) -> None:
    deck_id = _deck(catalog_conn)
    inventory.create_lot(catalog_conn, scryfall_id="bolt-1", quantity=3)
    _slot(catalog_conn, deck_id, "bolt-1", board="main", quantity=2)
    _slot(catalog_conn, deck_id, "bolt-1", board="sideboard", quantity=2)

    lines = {ln["board"]: ln for ln in _breakdown(catalog_conn, deck_id)["lines"]}

    assert lines["main"]["needed"] == 0
    assert lines["main"]["swap_hint"] is None
    assert lines["sideboard"]["needed"] == 1
    assert isinstance(lines["sideboard"]["swap_hint"], dict)


def test_breakdown_empty_deck(catalog_conn: sqlite3.Connection) -> None:
    deck_id = _deck(catalog_conn)
    assert _breakdown(catalog_conn, deck_id) == {
        "deck_id": deck_id,
        "lines": [],
        "totals": {"cards": 0, "have": 0, "needed": 0},
    }


def test_breakdown_missing_deck_returns_none(catalog_conn: sqlite3.Connection) -> None:
    assert decks.breakdown(catalog_conn, 999) is None
