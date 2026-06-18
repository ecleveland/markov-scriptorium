"""Tests for the bulk-onboarding resolve endpoint (VEG-280).

Seed a tmp catalog, then drive POST /onboarding/resolve through the TestClient.
The module-level client is used without a `with` block, so the lifespan (and its
background refresh) never fires — no network.
"""

from __future__ import annotations

import sqlite3
from contextlib import closing
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from scriptorium import db
from scriptorium.main import app
from scriptorium.migrations import apply_migrations

client = TestClient(app)

_REQUIRED_DEFAULTS = {"set_name": "Test Set", "rarity": "common", "lang": "en", "layout": "normal"}


def _insert_card(
    conn: sqlite3.Connection,
    scryfall_id: str,
    name: str,
    set_code: str,
    collector_number: str,
) -> None:
    cols = {
        "scryfall_id": scryfall_id,
        "name": name,
        "set_code": set_code,
        "collector_number": collector_number,
        **_REQUIRED_DEFAULTS,
    }
    placeholders = ", ".join("?" for _ in cols)
    conn.execute(
        f"INSERT INTO cards ({', '.join(cols)}) VALUES ({placeholders})",
        tuple(cols.values()),
    )


@pytest.fixture(autouse=True)
def seeded_catalog(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SCRIPTORIUM_DB_PATH", str(tmp_path / "catalog.db"))
    with closing(db.connect()) as conn:
        apply_migrations(conn)
        _insert_card(conn, "bolt-lea", "Lightning Bolt", "lea", "161")
        _insert_card(conn, "bolt-m10", "Lightning Bolt", "m10", "146")
        _insert_card(conn, "sol-cmd", "Sol Ring", "cmd", "256")
        conn.commit()


def test_resolve_classifies_entries_and_summarizes() -> None:
    resp = client.post(
        "/onboarding/resolve",
        json={
            "entries": [
                {"name": "Sol Ring", "quantity": 3},
                {"name": "Lightning Bolt"},
                {"name": "Black Lotus"},
            ]
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    statuses = [r["status"] for r in body["results"]]
    assert statuses == ["matched", "ambiguous", "unmatched"]
    assert body["summary"] == {"matched": 1, "ambiguous": 1, "unmatched": 1}
    # Matched echoes the printing and the input quantity.
    assert body["results"][0]["match"]["scryfall_id"] == "sol-cmd"
    assert body["results"][0]["input"]["quantity"] == 3
    # Ambiguous returns the candidate printings to choose from.
    assert {c["scryfall_id"] for c in body["results"][1]["candidates"]} == {
        "bolt-lea",
        "bolt-m10",
    }


def test_resolve_set_pin_disambiguates() -> None:
    resp = client.post(
        "/onboarding/resolve",
        json={"entries": [{"name": "Lightning Bolt", "set_code": "m10"}]},
    )
    body = resp.json()
    assert body["results"][0]["status"] == "matched"
    assert body["results"][0]["match"]["scryfall_id"] == "bolt-m10"


def test_resolve_requires_a_name() -> None:
    resp = client.post("/onboarding/resolve", json={"entries": [{"name": ""}]})
    assert resp.status_code == 422


def test_resolve_rejects_empty_batch() -> None:
    assert client.post("/onboarding/resolve", json={"entries": []}).status_code == 422
