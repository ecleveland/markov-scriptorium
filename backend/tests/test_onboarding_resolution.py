"""Tests for the bulk-onboarding resolution service (VEG-280).

Seed a tmp catalog with a handful of printings (including a name reprinted
across two sets) and assert each raw entry resolves to matched / ambiguous /
unmatched, that set-code and collector-number pins narrow an ambiguous name to
one printing, and that matching is case-insensitive.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from contextlib import closing
from pathlib import Path

import pytest

from scriptorium import db
from scriptorium.migrations import apply_migrations
from scriptorium.onboarding.resolution import (
    RawEntry,
    resolve_entries,
    resolve_entry,
    summarize,
)

_REQUIRED_DEFAULTS = {
    "set_name": "Test Set",
    "rarity": "common",
    "lang": "en",
    "layout": "normal",
}


def _insert_card(
    conn: sqlite3.Connection,
    scryfall_id: str,
    name: str,
    set_code: str,
    collector_number: str,
    **overrides: object,
) -> None:
    cols = {
        "scryfall_id": scryfall_id,
        "name": name,
        "set_code": set_code,
        "collector_number": collector_number,
        **_REQUIRED_DEFAULTS,
        **overrides,
    }
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
    # Lightning Bolt printed in two sets (ambiguous by name); Sol Ring once.
    _insert_card(conn, "bolt-lea", "Lightning Bolt", "lea", "161", released_at="1993-08-05")
    _insert_card(conn, "bolt-m10", "Lightning Bolt", "m10", "146", released_at="2009-07-17")
    _insert_card(conn, "sol-cmd", "Sol Ring", "cmd", "256")
    conn.commit()
    with closing(conn):
        yield conn


def test_unique_name_matches(catalog_conn: sqlite3.Connection) -> None:
    result = resolve_entry(catalog_conn, RawEntry(name="Sol Ring", quantity=2))
    assert result["status"] == "matched"
    assert result["match"]["scryfall_id"] == "sol-cmd"
    assert result["candidates"] == []
    # The original entry is echoed back for the caller's preview.
    assert result["input"]["quantity"] == 2


def test_name_in_multiple_sets_is_ambiguous(catalog_conn: sqlite3.Connection) -> None:
    result = resolve_entry(catalog_conn, RawEntry(name="Lightning Bolt"))
    assert result["status"] == "ambiguous"
    assert result["match"] is None
    assert {c["scryfall_id"] for c in result["candidates"]} == {"bolt-lea", "bolt-m10"}
    # Candidates are ordered oldest-first.
    assert [c["scryfall_id"] for c in result["candidates"]] == ["bolt-lea", "bolt-m10"]


def test_set_code_pin_resolves_ambiguity(catalog_conn: sqlite3.Connection) -> None:
    result = resolve_entry(catalog_conn, RawEntry(name="Lightning Bolt", set_code="M10"))
    assert result["status"] == "matched"
    assert result["match"]["scryfall_id"] == "bolt-m10"


def test_collector_number_further_narrows(catalog_conn: sqlite3.Connection) -> None:
    result = resolve_entry(
        catalog_conn,
        RawEntry(name="Lightning Bolt", set_code="lea", collector_number="161"),
    )
    assert result["status"] == "matched"
    assert result["match"]["scryfall_id"] == "bolt-lea"


def test_collector_number_pin_is_case_insensitive(catalog_conn: sqlite3.Connection) -> None:
    """Collector numbers can carry letters; a case mismatch must not miss."""
    _insert_card(catalog_conn, "promo-a", "Shock", "pgw", "12a")
    catalog_conn.commit()
    result = resolve_entry(catalog_conn, RawEntry(name="Shock", collector_number="12A"))
    assert result["status"] == "matched"
    assert result["match"]["scryfall_id"] == "promo-a"


def test_ambiguous_candidates_tiebreak_by_set_code(catalog_conn: sqlite3.Connection) -> None:
    """When released_at ties, candidates order by set_code then collector number."""
    _insert_card(catalog_conn, "twin-zzz", "Twincast", "zzz", "1", released_at="2020-01-01")
    _insert_card(catalog_conn, "twin-aaa", "Twincast", "aaa", "1", released_at="2020-01-01")
    catalog_conn.commit()
    result = resolve_entry(catalog_conn, RawEntry(name="Twincast"))
    assert result["status"] == "ambiguous"
    assert [c["scryfall_id"] for c in result["candidates"]] == ["twin-aaa", "twin-zzz"]


def test_unknown_name_is_unmatched(catalog_conn: sqlite3.Connection) -> None:
    result = resolve_entry(catalog_conn, RawEntry(name="Black Lotus"))
    assert result["status"] == "unmatched"
    assert result["match"] is None and result["candidates"] == []


def test_set_pin_with_no_such_printing_is_unmatched(catalog_conn: sqlite3.Connection) -> None:
    result = resolve_entry(catalog_conn, RawEntry(name="Sol Ring", set_code="zzz"))
    assert result["status"] == "unmatched"


def test_name_match_is_case_insensitive(catalog_conn: sqlite3.Connection) -> None:
    result = resolve_entry(catalog_conn, RawEntry(name="sOl RiNg"))
    assert result["status"] == "matched"


def test_front_face_name_resolves(catalog_conn: sqlite3.Connection) -> None:
    """A decklist names a multi-faced card by its front face; it must still match."""
    _insert_card(
        catalog_conn,
        "delver-isd",
        "Delver of Secrets // Insectile Aberration",
        "isd",
        "51",
        layout="transform",
    )
    catalog_conn.commit()
    result = resolve_entry(catalog_conn, RawEntry(name="Delver of Secrets"))
    assert result["status"] == "matched"
    assert result["match"]["scryfall_id"] == "delver-isd"


def test_scryfall_id_short_circuits_to_exact_printing(catalog_conn: sqlite3.Connection) -> None:
    """A Scryfall ID names one printing; it wins even over a name in many sets."""
    result = resolve_entry(catalog_conn, RawEntry(name="Lightning Bolt", scryfall_id="bolt-m10"))
    assert result["status"] == "matched"
    assert result["match"]["scryfall_id"] == "bolt-m10"
    assert result["candidates"] == []
    # The match is shaped like the name-path printings — no card_faces key.
    assert "card_faces" not in result["match"]


def test_unknown_scryfall_id_falls_back_to_name(catalog_conn: sqlite3.Connection) -> None:
    """A stale/foreign ID absent from the catalog must not sink a resolvable name."""
    result = resolve_entry(catalog_conn, RawEntry(name="Sol Ring", scryfall_id="not-in-catalog"))
    assert result["status"] == "matched"
    assert result["match"]["scryfall_id"] == "sol-cmd"


def test_unknown_scryfall_id_and_unknown_name_is_unmatched(
    catalog_conn: sqlite3.Connection,
) -> None:
    result = resolve_entry(catalog_conn, RawEntry(name="Black Lotus", scryfall_id="nope"))
    assert result["status"] == "unmatched"


def test_set_name_filter_narrows_ambiguous(catalog_conn: sqlite3.Connection) -> None:
    """Deckbox names the edition, not its code; set_name narrows the candidates."""
    _insert_card(
        catalog_conn, "bolt-war", "Lightning Bolt", "war", "1", set_name="War of the Spark"
    )
    catalog_conn.commit()
    result = resolve_entry(
        catalog_conn, RawEntry(name="Lightning Bolt", set_name="War of the Spark")
    )
    assert result["status"] == "matched"
    assert result["match"]["scryfall_id"] == "bolt-war"


def test_set_code_takes_precedence_over_set_name(catalog_conn: sqlite3.Connection) -> None:
    """When both are present (unusual), the exact code wins over the display name."""
    result = resolve_entry(
        catalog_conn,
        RawEntry(name="Lightning Bolt", set_code="lea", set_name="Nonexistent Set"),
    )
    assert result["status"] == "matched"
    assert result["match"]["scryfall_id"] == "bolt-lea"


def test_resolve_entries_preserves_order_and_summarizes(
    catalog_conn: sqlite3.Connection,
) -> None:
    results = resolve_entries(
        catalog_conn,
        [
            RawEntry(name="Sol Ring"),
            RawEntry(name="Lightning Bolt"),
            RawEntry(name="Black Lotus"),
        ],
    )
    assert [r["status"] for r in results] == ["matched", "ambiguous", "unmatched"]
    assert summarize(results) == {"matched": 1, "ambiguous": 1, "unmatched": 1}
