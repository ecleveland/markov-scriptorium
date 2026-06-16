"""Tests for the card lookup endpoints (VEG-215).

Seed a tmp catalog, then drive the endpoints through the FastAPI TestClient.
The module-level client is used without a `with` block, so the lifespan (and its
background refresh) never fires — no network.
"""

from __future__ import annotations

import sqlite3
from contextlib import closing
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from scriptorium import catalog, db
from scriptorium.main import app
from scriptorium.migrations import apply_migrations

client = TestClient(app)

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


@pytest.fixture(autouse=True)
def seeded_catalog(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SCRIPTORIUM_DB_PATH", str(tmp_path / "catalog.db"))
    with closing(db.connect()) as conn:
        apply_migrations(conn)
        _insert_card(conn, "bolt-1", "Lightning Bolt", set_code="lea", colors='["R"]')
        _insert_card(conn, "bolt-2", "Lightning Bolt", set_code="m10", colors='["R"]')
        _insert_card(conn, "helix-1", "Lightning Helix", colors='["R","W"]')
        _insert_card(conn, "dfc-1", "Delver of Secrets // Insectile Aberration", layout="transform")
        conn.execute(
            "INSERT INTO card_faces (scryfall_id, face_index, name, colors) VALUES (?, ?, ?, ?)",
            ("dfc-1", 0, "Delver of Secrets", '["U"]'),
        )
        catalog.rebuild_name_index(conn)
        conn.commit()


# --- GET /cards/{scryfall_id} ----------------------------------------------


def test_get_card_returns_detail_with_faces() -> None:
    resp = client.get("/cards/dfc-1")
    assert resp.status_code == 200
    body = resp.json()
    assert body["name"].startswith("Delver of Secrets")
    assert [f["name"] for f in body["card_faces"]] == ["Delver of Secrets"]
    assert body["card_faces"][0]["colors"] == ["U"]


def test_get_card_deserializes_json_columns() -> None:
    body = client.get("/cards/bolt-1").json()
    assert body["colors"] == ["R"]


def test_get_card_missing_returns_404() -> None:
    resp = client.get("/cards/nope")
    assert resp.status_code == 404
    assert "catalog" in resp.json()["detail"].lower()


# --- GET /cards/search -----------------------------------------------------


def test_search_returns_results_and_total() -> None:
    body = client.get("/cards/search", params={"q": "bolt"}).json()
    assert body["total"] == 2
    assert {r["name"] for r in body["results"]} == {"Lightning Bolt"}
    assert body["limit"] == 20
    assert body["offset"] == 0


def test_search_pagination_params_echoed() -> None:
    body = client.get("/cards/search", params={"q": "lightning", "limit": 1, "offset": 1}).json()
    assert body["limit"] == 1
    assert body["offset"] == 1
    assert len(body["results"]) == 1


def test_search_requires_q() -> None:
    assert client.get("/cards/search").status_code == 422


def test_search_rejects_out_of_range_limit() -> None:
    assert client.get("/cards/search", params={"q": "bolt", "limit": 0}).status_code == 422
    assert client.get("/cards/search", params={"q": "bolt", "limit": 1000}).status_code == 422


def test_search_route_not_shadowed_by_id() -> None:
    """/cards/search hits the search handler, not the /{scryfall_id} lookup."""
    resp = client.get("/cards/search", params={"q": "bolt"})
    assert resp.status_code == 200
    assert "results" in resp.json()


# --- GET /cards/autocomplete -----------------------------------------------


def test_autocomplete_returns_distinct_names() -> None:
    body = client.get("/cards/autocomplete", params={"q": "lightning"}).json()
    assert body["names"] == ["Lightning Bolt", "Lightning Helix"]


def test_autocomplete_requires_q() -> None:
    assert client.get("/cards/autocomplete").status_code == 422


def test_autocomplete_rejects_out_of_range_limit() -> None:
    assert client.get("/cards/autocomplete", params={"q": "li", "limit": 99}).status_code == 422
