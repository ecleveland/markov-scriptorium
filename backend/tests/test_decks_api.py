"""Tests for the Tome endpoints (VEG-223).

Seed a tmp catalog, then drive the endpoints through the FastAPI TestClient.
The module-level client is used without a `with` block, so the lifespan (and its
background refresh) never fires, and no test touches the network.
"""

from __future__ import annotations

import sqlite3
from contextlib import closing
from pathlib import Path
from typing import Any, NoReturn

import pytest
from fastapi.testclient import TestClient

from scriptorium import db, decks
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
        _insert_card(conn, "edgar-1", "Edgar Markov", set_code="c17")
        _insert_card(conn, "bolt-1", "Lightning Bolt")
        _insert_card(conn, "ghast-1", "Bloodghast")
        conn.commit()


def _create(**body: object) -> dict[str, Any]:
    """POST a Tome and return it, asserting a 201."""
    resp = client.post("/decks", json={"name": "Edgar's Court", **body})
    assert resp.status_code == 201, resp.text
    created: dict[str, Any] = resp.json()
    return created


def _add(deck_id: int, **body: object) -> dict[str, Any]:
    """POST a slot and return it, asserting a 201."""
    resp = client.post(f"/decks/{deck_id}/cards", json={"scryfall_id": "bolt-1", **body})
    assert resp.status_code == 201, resp.text
    slot: dict[str, Any] = resp.json()
    return slot


# --- POST /decks -------------------------------------------------------------


def test_create_deck_returns_201_with_defaults() -> None:
    deck = _create()
    assert deck["id"] >= 1
    assert deck["name"] == "Edgar's Court"
    assert (deck["format"], deck["status"], deck["claims_cards"]) == (None, "in_progress", True)


def test_create_deck_trims_name_and_normalizes_format() -> None:
    deck = _create(name="  \tEdgar's Court\n", format="  Commander ")
    assert deck["name"] == "Edgar's Court"
    assert deck["format"] == "commander"


@pytest.mark.parametrize(
    "body",
    [
        {"name": ""},
        {"name": " \t\n "},
        {"name": None},
        {},
        {"name": "Tome", "status": "retired"},
        {"name": "Tome", "format": "pauper cube"},
        {"name": "Tome", "format": "   "},
        {"name": "Tome", "claims_cards": "maybe"},
    ],
)
def test_create_deck_rejects_bad_body(body: dict[str, Any]) -> None:
    assert client.post("/decks", json=body).status_code == 422


# --- GET /decks --------------------------------------------------------------


def test_list_decks_newest_first_with_card_count() -> None:
    older = _create(name="Older")
    newer = _create(name="Newer")
    _add(older["id"], quantity=4)
    _add(older["id"], scryfall_id="ghast-1", board="maybeboard", quantity=2)

    resp = client.get("/decks")

    assert resp.status_code == 200
    body = resp.json()
    assert [d["id"] for d in body] == [newer["id"], older["id"]]
    assert [d["card_count"] for d in body] == [0, 4]


# --- GET /decks/{id} ---------------------------------------------------------


def test_get_deck_returns_cards_with_nested_card() -> None:
    deck = _create()
    _add(deck["id"], quantity=4)
    _add(deck["id"], scryfall_id="edgar-1", board="commander")

    resp = client.get(f"/decks/{deck['id']}")

    assert resp.status_code == 200
    body = resp.json()
    assert body["name"] == "Edgar's Court"
    assert [(c["board"], c["card"]["name"]) for c in body["cards"]] == [
        ("commander", "Edgar Markov"),
        ("main", "Lightning Bolt"),
    ]


def test_get_deck_unknown_is_404() -> None:
    assert client.get("/decks/999").status_code == 404


# --- PATCH /decks/{id} -------------------------------------------------------


def test_update_deck_changes_fields_and_clears_with_null() -> None:
    deck = _create(format="modern", notes="old notes")
    resp = client.patch(
        f"/decks/{deck['id']}",
        json={"name": " Renamed ", "status": "active", "claims_cards": False, "notes": None},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["name"] == "Renamed"
    assert body["status"] == "active"
    assert body["claims_cards"] is False
    assert body["notes"] is None
    assert body["format"] == "modern"

    resp = client.patch(f"/decks/{deck['id']}", json={"format": None})
    assert resp.json()["format"] is None


@pytest.mark.parametrize(
    "body",
    [
        {"name": None},
        {"name": "  "},
        {"status": None},
        {"status": "retired"},
        {"claims_cards": None},
        {"format": "Not A Format!"},
    ],
)
def test_update_deck_rejects_bad_body(body: dict[str, Any]) -> None:
    deck = _create()
    assert client.patch(f"/decks/{deck['id']}", json=body).status_code == 422


def test_update_deck_unknown_is_404() -> None:
    assert client.patch("/decks/999", json={"name": "Ghost"}).status_code == 404


# --- DELETE /decks/{id} ------------------------------------------------------


def test_delete_deck_is_204_then_404() -> None:
    deck = _create()
    _add(deck["id"])
    resp = client.delete(f"/decks/{deck['id']}")
    assert resp.status_code == 204
    assert resp.content == b""
    assert client.get(f"/decks/{deck['id']}").status_code == 404
    assert client.delete(f"/decks/{deck['id']}").status_code == 404


# --- POST /decks/{id}/cards --------------------------------------------------


def test_add_slot_creates_then_merges() -> None:
    deck = _create()
    first = _add(deck["id"], quantity=2, finish="foil")
    assert first["card"]["name"] == "Lightning Bolt"
    assert (first["finish"], first["board"], first["quantity"]) == ("foil", "main", 2)
    second = _add(deck["id"], quantity=1, finish="foil")
    assert second["id"] == first["id"]
    assert second["quantity"] == 3


@pytest.mark.parametrize(
    "body",
    [
        {"scryfall_id": "bolt-1", "quantity": 0},
        {"scryfall_id": "bolt-1", "quantity": -1},
        {"scryfall_id": "bolt-1", "board": "command_zone"},
        {"scryfall_id": "bolt-1", "finish": "holo"},
        {"scryfall_id": ""},
        {"scryfall_id": "   "},
        {},
    ],
)
def test_add_slot_rejects_bad_body(body: dict[str, Any]) -> None:
    deck = _create()
    assert client.post(f"/decks/{deck['id']}/cards", json=body).status_code == 422


def test_slot_scryfall_id_is_trimmed() -> None:
    deck = _create()
    slot = _add(deck["id"], scryfall_id=" bolt-1 ")
    assert slot["scryfall_id"] == "bolt-1"
    resp = client.patch(
        f"/decks/{deck['id']}/cards/{slot['id']}", json={"scryfall_id": "\tghast-1\n"}
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["scryfall_id"] == "ghast-1"


def test_add_slot_unknown_deck_is_404() -> None:
    resp = client.post("/decks/999/cards", json={"scryfall_id": "bolt-1"})
    assert resp.status_code == 404


def test_add_slot_unknown_printing_is_404() -> None:
    deck = _create()
    resp = client.post(f"/decks/{deck['id']}/cards", json={"scryfall_id": "no-such-card"})
    assert resp.status_code == 404
    assert "no-such-card" in resp.json()["detail"]


def test_add_slot_duplicate_commander_is_409() -> None:
    deck = _create()
    first = _add(deck["id"], scryfall_id="edgar-1", board="commander")
    resp = client.post(
        f"/decks/{deck['id']}/cards", json={"scryfall_id": "edgar-1", "board": "commander"}
    )
    assert resp.status_code == 409
    assert str(first["id"]) in resp.json()["detail"]


def test_add_slot_commander_quantity_above_one_is_409() -> None:
    deck = _create()
    resp = client.post(
        f"/decks/{deck['id']}/cards",
        json={"scryfall_id": "edgar-1", "board": "commander", "quantity": 2},
    )
    assert resp.status_code == 409


# --- PATCH /decks/{id}/cards/{slot_id} ---------------------------------------


def test_update_slot_changes_quantity_and_finish() -> None:
    deck = _create()
    slot = _add(deck["id"])
    resp = client.patch(
        f"/decks/{deck['id']}/cards/{slot['id']}", json={"quantity": 3, "finish": "etched"}
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert (body["quantity"], body["finish"]) == (3, "etched")


def test_update_slot_swap_collision_is_409_naming_the_slot() -> None:
    deck = _create()
    foil = _add(deck["id"], finish="foil")
    nonfoil = _add(deck["id"])
    resp = client.patch(f"/decks/{deck['id']}/cards/{nonfoil['id']}", json={"finish": "foil"})
    assert resp.status_code == 409
    assert str(foil["id"]) in resp.json()["detail"]


def test_update_slot_commander_quantity_above_one_is_409() -> None:
    deck = _create()
    slot = _add(deck["id"], scryfall_id="edgar-1", board="commander")
    resp = client.patch(f"/decks/{deck['id']}/cards/{slot['id']}", json={"quantity": 2})
    assert resp.status_code == 409


def test_update_slot_unknown_printing_is_404() -> None:
    deck = _create()
    slot = _add(deck["id"])
    resp = client.patch(
        f"/decks/{deck['id']}/cards/{slot['id']}", json={"scryfall_id": "no-such-card"}
    )
    assert resp.status_code == 404


def test_update_slot_unknown_slot_or_wrong_deck_is_404() -> None:
    deck = _create()
    other = _create(name="Other")
    slot = _add(deck["id"])
    assert client.patch(f"/decks/{deck['id']}/cards/999", json={"quantity": 2}).status_code == 404
    resp = client.patch(f"/decks/{other['id']}/cards/{slot['id']}", json={"quantity": 2})
    assert resp.status_code == 404
    assert client.patch(f"/decks/999/cards/{slot['id']}", json={"quantity": 2}).status_code == 404


@pytest.mark.parametrize(
    "body",
    [
        {"quantity": 0},
        {"quantity": None},
        {"board": None},
        {"board": "command_zone"},
        {"finish": None},
        {"scryfall_id": None},
        {"scryfall_id": "  "},
    ],
)
def test_update_slot_rejects_bad_body(body: dict[str, Any]) -> None:
    deck = _create()
    slot = _add(deck["id"])
    assert client.patch(f"/decks/{deck['id']}/cards/{slot['id']}", json=body).status_code == 422


# --- DELETE /decks/{id}/cards/{slot_id} --------------------------------------


def test_delete_slot_is_204_then_404() -> None:
    deck = _create()
    other = _create(name="Other")
    slot = _add(deck["id"])
    assert client.delete(f"/decks/{other['id']}/cards/{slot['id']}").status_code == 404
    resp = client.delete(f"/decks/{deck['id']}/cards/{slot['id']}")
    assert resp.status_code == 204
    assert client.delete(f"/decks/{deck['id']}/cards/{slot['id']}").status_code == 404


# --- GET /decks/{id}/breakdown -----------------------------------------------


def test_breakdown_returns_lines_and_totals() -> None:
    deck = _create()
    _add(deck["id"], quantity=4)
    _add(deck["id"], scryfall_id="ghast-1", board="maybeboard")
    client.post("/inventory", json={"scryfall_id": "bolt-1", "quantity": 3})

    resp = client.get(f"/decks/{deck['id']}/breakdown")

    assert resp.status_code == 200
    body = resp.json()
    assert body["deck_id"] == deck["id"]
    assert len(body["lines"]) == 1
    line = body["lines"][0]
    assert (line["owned"], line["available"], line["have"], line["needed"]) == (3, 3, 3, 1)
    assert line["card"]["name"] == "Lightning Bolt"
    assert line["swap_hint"]["total_quantity"] == 3
    assert body["totals"] == {"cards": 4, "have": 3, "needed": 1}


def test_breakdown_unknown_deck_is_404() -> None:
    assert client.get("/decks/999/breakdown").status_code == 404


# --- IntegrityError fallbacks ------------------------------------------------


def test_integrity_error_fallbacks_never_500(monkeypatch: pytest.MonkeyPatch) -> None:
    """A database refusal answers 409 while the Tome exists and 404 once it is gone."""

    def boom(*args: object, **kwargs: object) -> NoReturn:
        raise sqlite3.IntegrityError("boom")

    deck = _create()
    slot = _add(deck["id"])
    monkeypatch.setattr(decks, "add_slot", boom)
    monkeypatch.setattr(decks, "update_slot", boom)
    cards_url = f"/decks/{deck['id']}/cards"
    slot_url = f"{cards_url}/{slot['id']}"

    resp = client.post(cards_url, json={"scryfall_id": "bolt-1"})
    assert resp.status_code == 409
    assert "refused" in resp.json()["detail"]
    resp = client.patch(slot_url, json={"quantity": 2})
    assert resp.status_code == 409
    assert "refused" in resp.json()["detail"]

    assert client.delete(f"/decks/{deck['id']}").status_code == 204

    assert client.post(cards_url, json={"scryfall_id": "bolt-1"}).status_code == 404
    assert client.patch(slot_url, json={"quantity": 2}).status_code == 404
