"""Tests for the catalog read layer (VEG-215).

Seed a fresh tmp catalog with a handful of printings, rebuild the FTS index
(external content needs it after direct inserts), then exercise lookup, search,
and autocomplete — including JSON deserialization, the trigram substring match,
the <3-character LIKE fallback, pagination, and distinct-name autocomplete.
"""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterator
from contextlib import closing
from pathlib import Path

import pytest

from scriptorium import catalog, db
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
        colors='["R"]',
        color_identity='["R"]',
        image_uris='{"normal":"https://img/bolt.jpg"}',
        oracle_text="Lightning Bolt deals 3 damage to any target.",
    )
    _insert_card(conn, "bolt-2", "Lightning Bolt", set_code="m10", colors='["R"]')  # 2nd printing
    _insert_card(conn, "helix-1", "Lightning Helix", colors='["R","W"]')
    _insert_card(conn, "boltwave-1", "Boltwave", colors='["R"]')
    _insert_card(conn, "counter-1", "Counterspell", colors='["U"]')
    _insert_card(conn, "will-1", "Yawgmoth's Will", colors='["B"]')
    _insert_card(conn, "dfc-1", "Delver of Secrets // Insectile Aberration", layout="transform")
    conn.executemany(
        "INSERT INTO card_faces (scryfall_id, face_index, name, colors, image_uris) "
        "VALUES (?, ?, ?, ?, ?)",
        [
            ("dfc-1", 0, "Delver of Secrets", '["U"]', '{"normal":"https://img/front.jpg"}'),
            ("dfc-1", 1, "Insectile Aberration", '["U"]', None),
        ],
    )
    catalog.rebuild_name_index(conn)
    conn.commit()
    with closing(conn):
        yield conn


# --- get_card --------------------------------------------------------------


def test_get_card_returns_deserialized_row(catalog_conn: sqlite3.Connection) -> None:
    card = catalog.get_card(catalog_conn, "bolt-1")
    assert card is not None
    assert card["name"] == "Lightning Bolt"
    assert card["set_code"] == "lea"
    # JSON-text columns come back as real JSON, not strings.
    assert card["colors"] == ["R"]
    assert card["image_uris"] == {"normal": "https://img/bolt.jpg"}
    assert card["card_faces"] == []


def test_get_card_includes_faces_deserialized(catalog_conn: sqlite3.Connection) -> None:
    card = catalog.get_card(catalog_conn, "dfc-1")
    assert card is not None
    faces = card["card_faces"]
    assert [f["name"] for f in faces] == ["Delver of Secrets", "Insectile Aberration"]
    assert faces[0]["colors"] == ["U"]
    assert faces[0]["image_uris"] == {"normal": "https://img/front.jpg"}
    assert faces[1]["image_uris"] is None


def test_get_card_missing_returns_none(catalog_conn: sqlite3.Connection) -> None:
    assert catalog.get_card(catalog_conn, "no-such-id") is None


# --- search_cards ----------------------------------------------------------


def test_search_substring_matches_anywhere(catalog_conn: sqlite3.Connection) -> None:
    results, total = catalog.search_cards(catalog_conn, "bolt")
    names = sorted({r["name"] for r in results})
    assert names == ["Boltwave", "Lightning Bolt"]
    # Two printings of Lightning Bolt + Boltwave = 3 printing rows.
    assert total == 3
    assert len(results) == 3


def test_search_is_case_insensitive(catalog_conn: sqlite3.Connection) -> None:
    results, total = catalog.search_cards(catalog_conn, "BOLT")
    assert total == 3
    assert {r["name"] for r in results} == {"Boltwave", "Lightning Bolt"}


def test_search_handles_punctuation(catalog_conn: sqlite3.Connection) -> None:
    results, total = catalog.search_cards(catalog_conn, "Yawgmoth's")
    assert total == 1
    assert results[0]["name"] == "Yawgmoth's Will"


def test_search_results_are_deserialized(catalog_conn: sqlite3.Connection) -> None:
    results, _ = catalog.search_cards(catalog_conn, "helix")
    assert results[0]["colors"] == ["R", "W"]
    assert "card_faces" not in results[0]  # search rows stay light


def test_search_pagination(catalog_conn: sqlite3.Connection) -> None:
    first, total = catalog.search_cards(catalog_conn, "bolt", limit=2, offset=0)
    second, _ = catalog.search_cards(catalog_conn, "bolt", limit=2, offset=2)
    assert total == 3
    assert len(first) == 2
    assert len(second) == 1
    ids = {r["scryfall_id"] for r in first} | {r["scryfall_id"] for r in second}
    assert len(ids) == 3  # no overlap across pages


def test_search_short_query_uses_like_fallback(catalog_conn: sqlite3.Connection) -> None:
    # "li" is too short for trigram; LIKE substring still finds the Lightnings.
    results, total = catalog.search_cards(catalog_conn, "li")
    assert {r["name"] for r in results} == {"Lightning Bolt", "Lightning Helix"}
    assert total == 3  # two Bolt printings + one Helix


def test_search_blank_query_returns_empty(catalog_conn: sqlite3.Connection) -> None:
    assert catalog.search_cards(catalog_conn, "   ") == ([], 0)


def test_search_no_match(catalog_conn: sqlite3.Connection) -> None:
    assert catalog.search_cards(catalog_conn, "planeswalker") == ([], 0)


# --- autocomplete_names ----------------------------------------------------


def test_autocomplete_returns_distinct_names(catalog_conn: sqlite3.Connection) -> None:
    names = catalog.autocomplete_names(catalog_conn, "bolt")
    # Lightning Bolt has two printings but appears once.
    assert names.count("Lightning Bolt") == 1
    assert set(names) == {"Boltwave", "Lightning Bolt"}


def test_autocomplete_short_query_prefix(catalog_conn: sqlite3.Connection) -> None:
    names = catalog.autocomplete_names(catalog_conn, "li")
    # Prefix match: only names starting with "li".
    assert names == ["Lightning Bolt", "Lightning Helix"]


def test_autocomplete_respects_limit(catalog_conn: sqlite3.Connection) -> None:
    names = catalog.autocomplete_names(catalog_conn, "lightning", limit=1)
    assert len(names) == 1


def test_autocomplete_blank_returns_empty(catalog_conn: sqlite3.Connection) -> None:
    assert catalog.autocomplete_names(catalog_conn, "  ") == []


# --- rebuild_name_index ----------------------------------------------------


def test_rebuild_reflects_new_rows(catalog_conn: sqlite3.Connection) -> None:
    """A card inserted after the last rebuild only becomes searchable on rebuild."""
    _insert_card(catalog_conn, "brainstorm-1", "Brainstorm", colors='["U"]')
    catalog_conn.commit()
    assert catalog.search_cards(catalog_conn, "brainstorm") == ([], 0)
    catalog.rebuild_name_index(catalog_conn)
    results, total = catalog.search_cards(catalog_conn, "brainstorm")
    assert total == 1 and results[0]["name"] == "Brainstorm"


def test_seed_colors_are_valid_json(catalog_conn: sqlite3.Connection) -> None:
    """Guard the fixture itself: stored color blobs are JSON the layer can parse."""
    raw = catalog_conn.execute("SELECT colors FROM cards WHERE scryfall_id='bolt-1'").fetchone()[0]
    assert json.loads(raw) == ["R"]


# --- trigram boundary, fallback escaping, pagination edges -----------------


def test_search_three_char_query_uses_fts_substring(catalog_conn: sqlite3.Connection) -> None:
    """Exactly 3 chars takes the FTS path and still matches mid-name (not prefix)."""
    results, total = catalog.search_cards(catalog_conn, "olt")  # inside "Bolt"
    assert {r["name"] for r in results} == {"Boltwave", "Lightning Bolt"}
    assert total == 3


def test_autocomplete_three_char_matches_midword(catalog_conn: sqlite3.Connection) -> None:
    """FTS autocomplete (>=3 chars) matches a substring a prefix LIKE would miss."""
    names = catalog.autocomplete_names(catalog_conn, "eli")  # inside "Helix"
    assert "Lightning Helix" in names


def test_search_offset_past_end_returns_empty_with_total(
    catalog_conn: sqlite3.Connection,
) -> None:
    results, total = catalog.search_cards(catalog_conn, "bolt", limit=10, offset=99)
    assert results == []
    assert total == 3  # total is independent of the paginated slice


def test_short_query_like_escapes_wildcards(catalog_conn: sqlite3.Connection) -> None:
    """The <3-char LIKE fallback treats % and _ literally, not as wildcards."""
    _insert_card(catalog_conn, "u-1", "a_b")
    _insert_card(catalog_conn, "p-1", "a%b")
    _insert_card(catalog_conn, "ctrl-1", "axbyb")
    catalog_conn.commit()  # LIKE path reads `cards` directly; no rebuild needed
    underscore, _ = catalog.search_cards(catalog_conn, "_b")
    assert {r["name"] for r in underscore} == {"a_b"}
    percent, _ = catalog.search_cards(catalog_conn, "%b")
    assert {r["name"] for r in percent} == {"a%b"}


def test_autocomplete_caps_at_limit_with_many_matches(catalog_conn: sqlite3.Connection) -> None:
    """With more distinct matches than the limit, return exactly `limit` distinct names."""
    for i in range(12):
        _insert_card(catalog_conn, f"goblin-{i}", f"Goblin Number {i:02d}")  # all contain "obl"
    catalog.rebuild_name_index(catalog_conn)
    catalog_conn.commit()
    names = catalog.autocomplete_names(catalog_conn, "obl", limit=10)
    assert len(names) == 10
    assert len(set(names)) == 10


def test_printings_by_name_exact_case_insensitive_ordered(catalog_conn: sqlite3.Connection) -> None:
    """Exact (case-insensitive) name match returns every printing, oldest-first."""
    printings = catalog.printings_by_name(catalog_conn, "lightning BOLT")
    assert [p["scryfall_id"] for p in printings] == ["bolt-1", "bolt-2"]
    # JSON columns come back deserialized, like the other catalog reads.
    assert printings[0]["colors"] == ["R"]
    # A name with no printing, and a blank query, both yield [].
    assert catalog.printings_by_name(catalog_conn, "Black Lotus") == []
    assert catalog.printings_by_name(catalog_conn, "  ") == []
