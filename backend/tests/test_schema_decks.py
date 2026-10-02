"""Tests for the Tome schema (migration 0006, VEG-222).

These assert the shape of the ``decks`` and ``deck_cards`` tables: a Tome row
with its format, status, and hybrid ``claims_cards`` flag, plus one slot row
per (deck, printing, finish, board) with a quantity.

Design choices the tests pin down (see ADR 0018):

* **A slot references a printing, never an inventory lot.** An unowned card is
  an ordinary slot with no matching inventory, and "owned vs needed" is a join.
* **A slot is a printing plus a finish.** Owned copies match on
  ``(scryfall_id, finish)``, summed across condition, language, and location.
  Foil and non-foil stay separate, as everywhere else.
* **Commander and companion are boards**, singleton by CHECK, so partners are
  two rows. ``maybeboard`` rows never claim cards, so every reservation and
  breakdown query excludes them.
* **Hybrid model, default reserved.** ``claims_cards`` is 1 unless the user
  marks the Tome as a reference-only brew.
* **Slots CASCADE with their deck and RESTRICT against the catalog**, the same
  protection inventory has (ADR 0009): a Scryfall refresh must not empty a Tome.
* **No triggers.** The migration runner rejects ``BEGIN``, so ``updated_at`` and
  over-reservation are application logic. The schema only supplies defaults.

The ``catalog`` fixture opens the database the way the app does (via
``db.connect()``), so foreign-key enforcement is ON.
"""

from __future__ import annotations

import re
import sqlite3
from contextlib import closing
from pathlib import Path

import pytest

from scriptorium import db
from scriptorium.migrations import apply_migrations


@pytest.fixture
def catalog(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> sqlite3.Connection:
    """A fresh catalog opened via ``db.connect()`` (FK enforcement on)."""
    monkeypatch.setenv("SCRIPTORIUM_DB_PATH", str(tmp_path / "catalog.db"))
    conn = db.connect()
    apply_migrations(conn)
    return conn


# Required (NOT NULL) columns for a minimal valid `cards` row, so slots have a
# real printing to reference. Mirrors test_schema_inventory's helper.
_CARD_DEFAULTS = {
    "set_code": "tst",
    "set_name": "Test Set",
    "collector_number": "1",
    "rarity": "common",
    "lang": "en",
    "layout": "normal",
    "color_identity": "[]",
    "finishes": '["nonfoil","foil"]',
}

_ISO_UTC = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")


def _insert_card(
    conn: sqlite3.Connection, scryfall_id: str, name: str, **overrides: object
) -> None:
    cols = {"scryfall_id": scryfall_id, "name": name, **_CARD_DEFAULTS, **overrides}
    placeholders = ", ".join("?" for _ in cols)
    conn.execute(
        f"INSERT INTO cards ({', '.join(cols)}) VALUES ({placeholders})",
        tuple(cols.values()),
    )


def _insert_row(conn: sqlite3.Connection, table: str, **cols: object) -> int:
    """Insert a row into ``table`` (defaults fill the rest); return its rowid."""
    placeholders = ", ".join("?" for _ in cols)
    cur = conn.execute(
        f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({placeholders})",
        tuple(cols.values()),
    )
    assert cur.lastrowid is not None
    return cur.lastrowid


def _insert_deck(conn: sqlite3.Connection, name: str = "Edgar's Court", **overrides: object) -> int:
    return _insert_row(conn, "decks", name=name, **overrides)


def _insert_slot(
    conn: sqlite3.Connection, deck_id: int, scryfall_id: str, **overrides: object
) -> int:
    return _insert_row(conn, "deck_cards", deck_id=deck_id, scryfall_id=scryfall_id, **overrides)


def _insert_inventory(conn: sqlite3.Connection, scryfall_id: str, **overrides: object) -> int:
    return _insert_row(conn, "inventory", scryfall_id=scryfall_id, **overrides)


def _columns(conn: sqlite3.Connection, table: str) -> set[str]:
    return {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}


def _pk_columns(conn: sqlite3.Connection, table: str) -> list[str]:
    rows = [(row[5], row[1]) for row in conn.execute(f"PRAGMA table_info({table})") if row[5]]
    return [name for _, name in sorted(rows)]


def _index_names(conn: sqlite3.Connection) -> set[str]:
    return {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'index'")}


def _unique_index_columns(conn: sqlite3.Connection, table: str) -> list[list[str]]:
    """Column lists of every UNIQUE index on ``table`` (declared or implicit)."""
    result = []
    for row in conn.execute(f"PRAGMA index_list({table})"):
        if row[2]:  # unique
            cols = [info[2] for info in conn.execute(f"PRAGMA index_info({row[1]})")]
            result.append(cols)
    return result


# --- Shape ------------------------------------------------------------------


def test_decks_table_has_expected_columns(catalog: sqlite3.Connection) -> None:
    with closing(catalog) as conn:
        expected = {
            "id",
            "name",
            "format",
            "status",
            "claims_cards",
            "notes",
            "changelog",
            "created_at",
            "updated_at",
        }
        assert expected <= _columns(conn, "decks")
        assert _pk_columns(conn, "decks") == ["id"]


def test_deck_cards_table_has_expected_columns(catalog: sqlite3.Connection) -> None:
    with closing(catalog) as conn:
        expected = {"id", "deck_id", "scryfall_id", "finish", "board", "quantity"}
        assert expected <= _columns(conn, "deck_cards")
        # Surrogate slot key: VEG-223's :card_id route param is this id.
        assert _pk_columns(conn, "deck_cards") == ["id"]


def test_deck_defaults_and_timestamps(catalog: sqlite3.Connection) -> None:
    """A deck inserted with only a name is in progress, claims its cards, and is stamped."""
    with closing(catalog) as conn:
        deck = _insert_deck(conn)
        row = conn.execute(
            "SELECT format, status, claims_cards, notes, changelog, created_at, updated_at"
            " FROM decks WHERE id = ?",
            (deck,),
        ).fetchone()
        fmt, status, claims, notes, changelog, created_at, updated_at = row
        assert (fmt, status, claims, notes, changelog) == (None, "in_progress", 1, None, None)
        assert _ISO_UTC.match(created_at)
        assert _ISO_UTC.match(updated_at)


def test_slot_defaults(catalog: sqlite3.Connection) -> None:
    with closing(catalog) as conn:
        _insert_card(conn, "card-1", "Edgar Markov")
        deck = _insert_deck(conn)
        slot = _insert_slot(conn, deck, "card-1")
        row = conn.execute(
            "SELECT finish, board, quantity FROM deck_cards WHERE id = ?", (slot,)
        ).fetchone()
        assert tuple(row) == ("nonfoil", "main", 1)


def test_expected_indexes_exist(catalog: sqlite3.Connection) -> None:
    with closing(catalog) as conn:
        assert "idx_deck_cards_scryfall_finish" in _index_names(conn)
        assert ["deck_id", "scryfall_id", "finish", "board"] in _unique_index_columns(
            conn, "deck_cards"
        )


# --- Domains ----------------------------------------------------------------


def test_status_is_constrained(catalog: sqlite3.Connection) -> None:
    with closing(catalog) as conn:
        for status in ("in_progress", "active", "playtest", "shelved"):
            _insert_deck(conn, f"Tome {status}", status=status)
        for bad in ("in-progress", "retired", ""):
            with pytest.raises(sqlite3.IntegrityError):
                _insert_deck(conn, "Bad status", status=bad)


def test_claims_cards_is_boolean(catalog: sqlite3.Connection) -> None:
    with closing(catalog) as conn:
        _insert_deck(conn, "Sleeved", claims_cards=1)
        _insert_deck(conn, "Brew folder", claims_cards=0)
        with pytest.raises(sqlite3.IntegrityError):
            _insert_deck(conn, "Bad flag", claims_cards=2)


def test_format_is_free_text_and_nullable(catalog: sqlite3.Connection) -> None:
    """Format holds a legalities key, 'cube', 'brew', or NULL. The app validates it."""
    with closing(catalog) as conn:
        for fmt in ("commander", "modern", "cube", "brew", "predh", None):
            _insert_deck(conn, f"Tome {fmt}", format=fmt)
        count = conn.execute("SELECT COUNT(*) FROM decks").fetchone()[0]
        assert count == 6


def test_blank_name_is_rejected(catalog: sqlite3.Connection) -> None:
    with closing(catalog) as conn:
        for bad in ("", "   "):
            with pytest.raises(sqlite3.IntegrityError):
                _insert_deck(conn, bad)
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute("INSERT INTO decks (name) VALUES (NULL)")


def test_slot_finish_is_constrained(catalog: sqlite3.Connection) -> None:
    with closing(catalog) as conn:
        _insert_card(conn, "card-2", "Lightning Bolt")
        deck = _insert_deck(conn)
        for finish in ("nonfoil", "foil", "etched"):
            _insert_slot(conn, deck, "card-2", finish=finish)
        for bad in ("any", "holographic"):
            with pytest.raises(sqlite3.IntegrityError):
                _insert_slot(conn, deck, "card-2", finish=bad, board="sideboard")


def test_slot_board_is_constrained(catalog: sqlite3.Connection) -> None:
    with closing(catalog) as conn:
        _insert_card(conn, "card-3", "Sol Ring")
        deck = _insert_deck(conn)
        for board in ("main", "sideboard", "commander", "companion", "maybeboard"):
            _insert_slot(conn, deck, "card-3", board=board)
        with pytest.raises(sqlite3.IntegrityError):
            _insert_slot(conn, deck, "card-3", board="command")


def test_slot_quantity_must_be_positive(catalog: sqlite3.Connection) -> None:
    with closing(catalog) as conn:
        _insert_card(conn, "card-4", "Counterspell")
        deck = _insert_deck(conn)
        with pytest.raises(sqlite3.IntegrityError):
            _insert_slot(conn, deck, "card-4", quantity=0)
        _insert_slot(conn, deck, "card-4", quantity=4)


@pytest.mark.parametrize("board", ["commander", "companion"])
def test_commander_and_companion_are_singletons(catalog: sqlite3.Connection, board: str) -> None:
    with closing(catalog) as conn:
        _insert_card(conn, "card-5", "Lurrus of the Dream-Den")
        deck = _insert_deck(conn)
        with pytest.raises(sqlite3.IntegrityError):
            _insert_slot(conn, deck, "card-5", board=board, quantity=2)
        _insert_slot(conn, deck, "card-5", board=board, quantity=1)


def test_partner_commanders_are_two_rows(catalog: sqlite3.Connection) -> None:
    with closing(catalog) as conn:
        _insert_card(conn, "partner-a", "Thrasios, Triton Hero")
        _insert_card(conn, "partner-b", "Tymna the Weaver")
        deck = _insert_deck(conn)
        _insert_slot(conn, deck, "partner-a", board="commander")
        _insert_slot(conn, deck, "partner-b", board="commander")
        count = conn.execute(
            "SELECT COUNT(*) FROM deck_cards WHERE deck_id = ? AND board = 'commander'", (deck,)
        ).fetchone()[0]
        assert count == 2


# --- Foreign keys -----------------------------------------------------------


def test_slot_for_missing_deck_is_rejected(catalog: sqlite3.Connection) -> None:
    with closing(catalog) as conn:
        _insert_card(conn, "card-6", "Brainstorm")
        with pytest.raises(sqlite3.IntegrityError):
            _insert_slot(conn, 999, "card-6")


def test_slot_for_missing_card_is_rejected(catalog: sqlite3.Connection) -> None:
    with closing(catalog) as conn:
        deck = _insert_deck(conn)
        with pytest.raises(sqlite3.IntegrityError):
            _insert_slot(conn, deck, "no-such-card")


def test_deleting_deck_cascades_to_slots_not_inventory(catalog: sqlite3.Connection) -> None:
    """Deleting a Tome releases its slots. The cards stay owned."""
    with closing(catalog) as conn:
        _insert_card(conn, "card-7", "Demonic Tutor")
        _insert_inventory(conn, "card-7", quantity=2)
        deck = _insert_deck(conn)
        _insert_slot(conn, deck, "card-7", quantity=2)
        conn.execute("DELETE FROM decks WHERE id = ?", (deck,))
        assert conn.execute("SELECT COUNT(*) FROM deck_cards").fetchone()[0] == 0
        assert conn.execute("SELECT SUM(quantity) FROM inventory").fetchone()[0] == 2


def test_deleting_slotted_card_is_blocked(catalog: sqlite3.Connection) -> None:
    """RESTRICT: a catalog delete cannot empty a Tome."""
    with closing(catalog) as conn:
        _insert_card(conn, "card-8", "Rhystic Study")
        deck = _insert_deck(conn)
        _insert_slot(conn, deck, "card-8")
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute("DELETE FROM cards WHERE scryfall_id = 'card-8'")


def test_updating_card_id_cascades_to_slots(catalog: sqlite3.Connection) -> None:
    with closing(catalog) as conn:
        _insert_card(conn, "old-id", "Phyrexian Tower")
        deck = _insert_deck(conn)
        _insert_slot(conn, deck, "old-id", quantity=1)
        conn.execute("UPDATE cards SET scryfall_id = 'new-id' WHERE scryfall_id = 'old-id'")
        rows = conn.execute("SELECT scryfall_id FROM deck_cards").fetchall()
        assert [tuple(r) for r in rows] == [("new-id",)]


def test_deck_cards_foreign_key_actions(catalog: sqlite3.Connection) -> None:
    """The FKs carry the exact actions ADR 0018 specifies."""
    with closing(catalog) as conn:
        fks = {f[2]: f for f in conn.execute("PRAGMA foreign_key_list(deck_cards)")}
        to_decks, to_cards = fks["decks"], fks["cards"]
        assert (to_decks[3], to_decks[4]) == ("deck_id", "id")
        assert to_decks[6] == "CASCADE"  # on_delete: slots die with their Tome
        assert (to_cards[3], to_cards[4]) == ("scryfall_id", "scryfall_id")
        assert to_cards[5] == "CASCADE"  # on_update: a re-keyed printing carries its slots
        assert to_cards[6] == "RESTRICT"  # on_delete: a slotted card cannot be deleted


# --- Slots ------------------------------------------------------------------


def test_foil_and_nonfoil_slots_coexist(catalog: sqlite3.Connection) -> None:
    with closing(catalog) as conn:
        _insert_card(conn, "card-9", "Mana Crypt")
        deck = _insert_deck(conn)
        _insert_slot(conn, deck, "card-9", finish="nonfoil")
        _insert_slot(conn, deck, "card-9", finish="foil")
        assert conn.execute("SELECT COUNT(*) FROM deck_cards").fetchone()[0] == 2


def test_same_printing_in_main_and_sideboard_coexist(catalog: sqlite3.Connection) -> None:
    with closing(catalog) as conn:
        _insert_card(conn, "card-10", "Pyroblast")
        deck = _insert_deck(conn)
        _insert_slot(conn, deck, "card-10", board="main", quantity=2)
        _insert_slot(conn, deck, "card-10", board="sideboard", quantity=2)
        assert conn.execute("SELECT COUNT(*) FROM deck_cards").fetchone()[0] == 2


def test_duplicate_slot_is_rejected(catalog: sqlite3.Connection) -> None:
    """One slot per (deck, printing, finish, board). Adding more raises its quantity."""
    with closing(catalog) as conn:
        _insert_card(conn, "card-11", "Swords to Plowshares")
        deck = _insert_deck(conn)
        _insert_slot(conn, deck, "card-11")
        with pytest.raises(sqlite3.IntegrityError):
            _insert_slot(conn, deck, "card-11")


def test_unowned_printing_can_be_slotted(catalog: sqlite3.Connection) -> None:
    """A needed card is an ordinary slot with no matching inventory."""
    with closing(catalog) as conn:
        _insert_card(conn, "card-12", "The One Ring")
        deck = _insert_deck(conn)
        _insert_slot(conn, deck, "card-12")
        assert conn.execute("SELECT COUNT(*) FROM inventory").fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM deck_cards").fetchone()[0] == 1


# --- Breakdown query --------------------------------------------------------

# The reference "owned vs needed" breakdown for one Tome. Owned copies match on
# (scryfall_id, finish). Other claiming Tomes take their share first
# (claimed_elsewhere), then this Tome's own demand for a folio is allocated in a
# fixed order (commander, companion, main, sideboard, then slot id) so the same
# folio in two boards is not counted twice. Maybeboard rows neither claim nor
# consume, so they are excluded from both terms.
_BREAKDOWN_SQL = """
WITH owned AS (
  SELECT scryfall_id, finish, SUM(quantity) AS n
  FROM inventory GROUP BY scryfall_id, finish),
claimed_elsewhere AS (
  SELECT dc.scryfall_id, dc.finish, SUM(dc.quantity) AS n
  FROM deck_cards dc JOIN decks d ON d.id = dc.deck_id
  WHERE d.claims_cards = 1 AND d.id <> :deck AND dc.board <> 'maybeboard'
  GROUP BY dc.scryfall_id, dc.finish),
slots AS (
  SELECT dc.id, dc.board, dc.scryfall_id, dc.finish, dc.quantity,
         COALESCE(o.n, 0) AS owned,
         MAX(0, COALESCE(o.n, 0) - COALESCE(ce.n, 0)) AS available,
         SUM(dc.quantity) OVER (
           PARTITION BY dc.scryfall_id, dc.finish
           ORDER BY CASE dc.board WHEN 'commander' THEN 0 WHEN 'companion' THEN 1
                                  WHEN 'main' THEN 2 ELSE 3 END, dc.id
           ROWS UNBOUNDED PRECEDING) AS demand_through_here
  FROM deck_cards dc
  LEFT JOIN owned o ON o.scryfall_id = dc.scryfall_id AND o.finish = dc.finish
  LEFT JOIN claimed_elsewhere ce ON ce.scryfall_id = dc.scryfall_id AND ce.finish = dc.finish
  WHERE dc.deck_id = :deck AND dc.board <> 'maybeboard')
SELECT s.id, s.board, s.scryfall_id, s.finish, s.quantity, s.owned, s.available,
       c.name, c.type_line, c.cmc,
       MIN(s.quantity, MAX(0, s.available - (s.demand_through_here - s.quantity))) AS have,
       s.quantity
         - MIN(s.quantity, MAX(0, s.available - (s.demand_through_here - s.quantity))) AS needed
FROM slots s JOIN cards c ON c.scryfall_id = s.scryfall_id
ORDER BY s.board, c.cmc, c.name
"""


def _breakdown(conn: sqlite3.Connection, deck: int) -> dict[tuple[str, str], tuple[int, int]]:
    """Map (scryfall_id, board) to (have, needed) for one Tome."""
    rows = conn.execute(_BREAKDOWN_SQL, {"deck": deck}).fetchall()
    return {(r["scryfall_id"], r["board"]): (r["have"], r["needed"]) for r in rows}


def test_breakdown_query_owned_vs_needed(catalog: sqlite3.Connection) -> None:
    """Pin the reference breakdown SQL. VEG-223 lifts ``_BREAKDOWN_SQL`` as its reference.

    Cases: owned, partly owned, unowned, the same folio in two boards, a folio
    claimed by another claiming Tome, a referenced (``claims_cards = 0``) Tome
    releasing its claim, and a maybeboard row that neither claims nor consumes.
    """
    with closing(catalog) as conn:
        for sid, name in [
            ("owned", "Sol Ring"),
            ("partial", "Lightning Bolt"),
            ("unowned", "The One Ring"),
            ("split", "Pyroblast"),
            ("contested", "Swords to Plowshares"),
            ("released", "Brainstorm"),
            ("maybe", "Counterspell"),
        ]:
            _insert_card(conn, sid, name)

        _insert_inventory(conn, "owned", quantity=1)
        _insert_inventory(conn, "partial", quantity=2)
        _insert_inventory(conn, "split", quantity=3)
        _insert_inventory(conn, "contested", quantity=4)
        _insert_inventory(conn, "released", quantity=4)
        _insert_inventory(conn, "maybe", quantity=1)

        tome = _insert_deck(conn, "Tome under test")
        rival = _insert_deck(conn, "Sleeved rival", claims_cards=1)
        brew = _insert_deck(conn, "Brew folder", claims_cards=0)
        dreamer = _insert_deck(conn, "Dreamer", claims_cards=1)

        _insert_slot(conn, tome, "owned", quantity=1)
        _insert_slot(conn, tome, "partial", quantity=4)
        _insert_slot(conn, tome, "unowned", quantity=1)
        # Main gets the lower id, so it is allocated first.
        _insert_slot(conn, tome, "split", board="main", quantity=2)
        _insert_slot(conn, tome, "split", board="sideboard", quantity=2)
        _insert_slot(conn, tome, "contested", quantity=4)
        _insert_slot(conn, tome, "released", quantity=4)
        _insert_slot(conn, tome, "maybe", quantity=1)
        _insert_slot(conn, tome, "maybe", board="maybeboard", quantity=1)

        _insert_slot(conn, rival, "contested", quantity=3)
        _insert_slot(conn, brew, "released", quantity=4)
        # Another claiming Tome's maybeboard does not take the only copy.
        _insert_slot(conn, dreamer, "maybe", board="maybeboard", quantity=1)

        assert _breakdown(conn, tome) == {
            ("owned", "main"): (1, 0),
            ("partial", "main"): (2, 2),
            ("unowned", "main"): (0, 1),
            ("split", "main"): (2, 0),
            ("split", "sideboard"): (1, 1),
            ("contested", "main"): (1, 3),
            ("released", "main"): (4, 0),
            # The Tome's own maybeboard row is absent and consumed nothing.
            ("maybe", "main"): (1, 0),
        }
