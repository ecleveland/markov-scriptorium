"""Tests for the inventory CRUD endpoints (VEG-218).

Seed a tmp catalog, then drive the endpoints through the FastAPI TestClient.
The module-level client is used without a `with` block, so the lifespan (and its
background refresh) never fires — no network.
"""

from __future__ import annotations

import sqlite3
from contextlib import closing
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from scriptorium import db
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
        _insert_card(conn, "bolt-1", "Lightning Bolt", set_code="lea")
        _insert_card(conn, "helix-1", "Lightning Helix")
        # A printing whose Scryfall ID is a bare number, to prove /inventory/card/1
        # routes to the rollup and is not parsed as integer lot id 1.
        _insert_card(conn, "1", "Numbered Printing")
        conn.commit()


def _inscribe(**body: object) -> dict[str, Any]:
    """POST a lot and return the created record, asserting a 201."""
    payload = {"scryfall_id": "bolt-1", **body}
    resp = client.post("/inventory", json=payload)
    assert resp.status_code == 201, resp.text
    created: dict[str, Any] = resp.json()
    return created


# --- POST /inventory -------------------------------------------------------


def test_inscribe_creates_lot() -> None:
    resp = client.post(
        "/inventory", json={"scryfall_id": "bolt-1", "quantity": 2, "finish": "foil"}
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["id"] >= 1
    assert body["quantity"] == 2
    assert body["finish"] == "foil"
    assert body["card"]["name"] == "Lightning Bolt"


def test_inscribe_applies_defaults() -> None:
    body = _inscribe()
    assert (body["quantity"], body["finish"], body["condition"], body["language"]) == (
        1,
        "nonfoil",
        "NM",
        "en",
    )


def test_inscribe_unknown_card_returns_404() -> None:
    resp = client.post("/inventory", json={"scryfall_id": "ghost"})
    assert resp.status_code == 404
    assert "catalog" in resp.json()["detail"].lower()


def test_inscribe_maps_fk_violation_to_404(monkeypatch: pytest.MonkeyPatch) -> None:
    """If the printing vanishes between the existence check and the insert
    (TOCTOU with a bulk refresh), the FK violation surfaces as a 404, not a 500."""
    from scriptorium import inventory

    monkeypatch.setattr(inventory, "printing_exists", lambda conn, sid: True)
    resp = client.post("/inventory", json={"scryfall_id": "ghost"})
    assert resp.status_code == 404
    assert "catalog" in resp.json()["detail"].lower()


def test_inscribe_rejects_bad_quantity() -> None:
    resp = client.post("/inventory", json={"scryfall_id": "bolt-1", "quantity": 0})
    assert resp.status_code == 422


def test_inscribe_rejects_unknown_finish() -> None:
    resp = client.post("/inventory", json={"scryfall_id": "bolt-1", "finish": "holo"})
    assert resp.status_code == 422


def test_inscribe_rejects_unknown_condition() -> None:
    resp = client.post("/inventory", json={"scryfall_id": "bolt-1", "condition": "MINT"})
    assert resp.status_code == 422


# --- GET /inventory --------------------------------------------------------


def test_list_returns_results_and_total() -> None:
    _inscribe()
    _inscribe(scryfall_id="helix-1")
    body = client.get("/inventory").json()
    assert body["total"] == 2
    assert len(body["results"]) == 2
    assert body["limit"] == 50
    assert body["offset"] == 0
    assert {r["card"]["name"] for r in body["results"]} == {"Lightning Bolt", "Lightning Helix"}


def test_list_pagination_params_echoed() -> None:
    for _ in range(3):
        _inscribe()
    body = client.get("/inventory", params={"limit": 1, "offset": 1}).json()
    assert body["limit"] == 1
    assert body["offset"] == 1
    assert len(body["results"]) == 1
    assert body["total"] == 3


def test_list_rejects_out_of_range_limit() -> None:
    assert client.get("/inventory", params={"limit": 0}).status_code == 422
    assert client.get("/inventory", params={"limit": 9999}).status_code == 422


# --- GET /inventory/{id} ---------------------------------------------------


def test_get_lot_detail() -> None:
    created = _inscribe(notes="foo")
    resp = client.get(f"/inventory/{created['id']}")
    assert resp.status_code == 200
    assert resp.json()["notes"] == "foo"


def test_get_lot_missing_returns_404() -> None:
    assert client.get("/inventory/999999").status_code == 404


# --- PATCH /inventory/{id} -------------------------------------------------


def test_patch_updates_fields() -> None:
    created = _inscribe(quantity=1, notes="old")
    resp = client.patch(
        f"/inventory/{created['id']}",
        json={"quantity": 4, "condition": "LP", "location": "Box A", "notes": "new"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert (body["quantity"], body["condition"], body["location"], body["notes"]) == (
        4,
        "LP",
        "Box A",
        "new",
    )


def test_patch_can_clear_location() -> None:
    created = _inscribe(location="Box A")
    body = client.patch(f"/inventory/{created['id']}", json={"location": None}).json()
    assert body["location"] is None


def test_patch_missing_returns_404() -> None:
    assert client.patch("/inventory/999999", json={"quantity": 2}).status_code == 404


def test_patch_rejects_bad_quantity() -> None:
    created = _inscribe()
    assert client.patch(f"/inventory/{created['id']}", json={"quantity": 0}).status_code == 422


def test_patch_explicit_null_on_not_null_field_is_clean_422() -> None:
    """Sending null for quantity/condition is a clean validation error, not a
    leaked raw SQLite constraint string."""
    created = _inscribe()
    for field in ("quantity", "condition"):
        resp = client.patch(f"/inventory/{created['id']}", json={field: None})
        assert resp.status_code == 422
        assert "constraint" not in resp.text.lower()  # no raw SQL leaked


def test_patch_ignores_unknown_field() -> None:
    """finish is folio-identity, not in the mutable set: PATCHing it is a no-op,
    not a 422, and leaves the lot unchanged."""
    created = _inscribe(finish="nonfoil")
    resp = client.patch(f"/inventory/{created['id']}", json={"finish": "foil"})
    assert resp.status_code == 200
    assert resp.json()["finish"] == "nonfoil"


# --- DELETE /inventory/{id} ------------------------------------------------


def test_delete_removes_lot() -> None:
    created = _inscribe()
    assert client.delete(f"/inventory/{created['id']}").status_code == 204
    assert client.get(f"/inventory/{created['id']}").status_code == 404


def test_delete_missing_returns_404() -> None:
    assert client.delete("/inventory/999999").status_code == 404


# --- GET /inventory/card/{scryfall_id} -------------------------------------


def test_owned_copies_rolls_up_by_folio() -> None:
    _inscribe(finish="nonfoil", quantity=2)
    _inscribe(finish="nonfoil", quantity=1)
    _inscribe(finish="foil", quantity=1)
    body = client.get("/inventory/card/bolt-1").json()
    assert body["total_quantity"] == 4
    assert len(body["lots"]) == 3
    rollup = {(r["finish"], r["condition"], r["language"]): r for r in body["rollup"]}
    assert rollup[("nonfoil", "NM", "en")]["quantity"] == 3
    assert rollup[("foil", "NM", "en")]["quantity"] == 1


def test_owned_copies_unowned_printing_is_empty() -> None:
    body = client.get("/inventory/card/helix-1")
    assert body.status_code == 200
    assert body.json()["total_quantity"] == 0
    assert body.json()["lots"] == []


def test_owned_copies_unknown_card_returns_404() -> None:
    assert client.get("/inventory/card/ghost").status_code == 404


def test_owned_copies_route_not_shadowed_by_id() -> None:
    """A numeric scryfall_id hits the rollup, not the integer /{lot_id} lookup.

    Seeds lot id 1, then GET /inventory/card/1 must return card "1"'s rollup
    shape (not lot 1's single-lot detail) — proving route precedence, not just
    that a non-numeric segment fails int parsing.
    """
    created = _inscribe()  # first lot in a fresh DB → id 1
    assert created["id"] == 1
    body = client.get("/inventory/card/1")
    assert body.status_code == 200
    assert "rollup" in body.json()
    assert body.json()["scryfall_id"] == "1"  # the card, not lot id 1
    # The sibling /{lot_id} route still resolves the integer lot.
    assert client.get("/inventory/1").json()["id"] == 1


# --- POST /inventory/bulk --------------------------------------------------


def test_bulk_inscribe_creates_all_rows() -> None:
    resp = client.post(
        "/inventory/bulk",
        json={
            "rows": [
                {"scryfall_id": "bolt-1", "quantity": 2, "finish": "foil"},
                {"scryfall_id": "helix-1", "quantity": 1},
            ]
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["count"] == 2
    assert [lot["scryfall_id"] for lot in body["created"]] == ["bolt-1", "helix-1"]
    assert client.get("/inventory").json()["total"] == 2


def test_bulk_inscribe_unknown_card_is_atomic_422() -> None:
    resp = client.post(
        "/inventory/bulk",
        json={
            "rows": [
                {"scryfall_id": "bolt-1", "quantity": 1},
                {"scryfall_id": "ghost", "quantity": 1},
            ]
        },
    )
    assert resp.status_code == 422
    detail = resp.json()["detail"]
    assert detail["unknown"] == [{"index": 1, "scryfall_id": "ghost"}]
    # Nothing was written — the good row rolled back with the batch.
    assert client.get("/inventory").json()["total"] == 0


def test_bulk_inscribe_rejects_empty_batch() -> None:
    assert client.post("/inventory/bulk", json={"rows": []}).status_code == 422


def test_bulk_inscribe_validates_rows() -> None:
    resp = client.post(
        "/inventory/bulk",
        json={"rows": [{"scryfall_id": "bolt-1", "finish": "holo"}]},
    )
    assert resp.status_code == 422
