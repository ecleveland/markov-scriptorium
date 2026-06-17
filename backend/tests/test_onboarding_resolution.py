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
