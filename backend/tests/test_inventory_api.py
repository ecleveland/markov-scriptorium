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

from scriptorium import db, inventory
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


def test_bulk_inscribe_rejects_explicit_null_in_not_null_field() -> None:
    resp = client.post(
        "/inventory/bulk",
        json={"rows": [{"scryfall_id": "bolt-1", "finish": None}]},
    )
    assert resp.status_code == 422


def test_bulk_inscribe_maps_fk_violation_to_422(monkeypatch: pytest.MonkeyPatch) -> None:
    """If a printing vanishes between the up-front check and the inserts (TOCTOU),
    the FK violation is a clean 422, not a raw 500, and nothing is written."""
    from scriptorium import inventory

    monkeypatch.setattr(inventory, "existing_printing_ids", lambda conn, ids: set(ids))
    resp = client.post("/inventory/bulk", json={"rows": [{"scryfall_id": "ghost", "quantity": 1}]})
    assert resp.status_code == 422
    assert "catalog" in resp.json()["detail"]["message"].lower()
    assert client.get("/inventory").json()["total"] == 0


def test_owned_copies_includes_across_printings_summary() -> None:
    """The rollup response carries the card-level total across printings."""
    with closing(db.connect()) as conn:
        _insert_card(conn, "bolt-2", "Lightning Bolt", set_code="2x2", oracle_id="oracle-bolt")
        conn.execute("UPDATE cards SET oracle_id = 'oracle-bolt' WHERE scryfall_id = 'bolt-1'")
        conn.commit()
    _inscribe(quantity=2)
    resp = client.post("/inventory", json={"scryfall_id": "bolt-2", "quantity": 3})
    assert resp.status_code == 201, resp.text

    body = client.get("/inventory/card/bolt-1").json()

    assert body["total_quantity"] == 2  # this printing only
    across = body["across_printings"]
    assert across["grouping"] == "oracle_id"
    assert across["name"] == "Lightning Bolt"
    assert across["total_quantity"] == 5
    assert across["printing_count"] == 2


def test_owned_copies_across_printings_zero_for_unowned() -> None:
    across = client.get("/inventory/card/helix-1").json()["across_printings"]
    assert across["total_quantity"] == 0
    assert across["printings"] == []


# --- reservations on reads (VEG-224) ---------------------------------------


def _claim(quantity: int, *, scryfall_id: str = "bolt-1", finish: str = "nonfoil") -> None:
    deck = client.post("/decks", json={"name": "Edgar's Court"})
    assert deck.status_code == 201, deck.text
    body = {"scryfall_id": scryfall_id, "finish": finish, "quantity": quantity}
    resp = client.post(f"/decks/{deck.json()['id']}/cards", json=body)
    assert resp.status_code == 201, resp.text


def test_lots_carry_their_folio_reservation() -> None:
    lot = _inscribe(quantity=3)
    _claim(2)

    listed = client.get("/inventory").json()["results"][0]
    detail = client.get(f"/inventory/{lot['id']}").json()

    assert listed["folio"] == {"owned": 3, "reserved": 2, "available": 1}
    assert detail["folio"] == {"owned": 3, "reserved": 2, "available": 1}


def test_owned_copies_carries_reservations_and_printing_counts() -> None:
    _inscribe(quantity=3)
    _inscribe(finish="foil")
    _claim(2)

    body = client.get("/inventory/card/bolt-1").json()

    assert body["reservations"] == [
        {"finish": "foil", "owned": 1, "reserved": 0, "available": 1},
        {"finish": "nonfoil", "owned": 3, "reserved": 2, "available": 1},
    ]
    (printing,) = body["across_printings"]["printings"]
    assert (printing["quantity"], printing["reserved"], printing["available"]) == (4, 2, 2)


# --- GET /inventory/search (VEG-227) ---------------------------------------


def test_search_without_params_echoes_paging_and_total() -> None:
    _inscribe(quantity=2)
    _inscribe()
    _inscribe(scryfall_id="helix-1")

    body = client.get("/inventory/search").json()

    assert (body["limit"], body["offset"], body["total"]) == (50, 0, 2)
    by_name = {r["card"]["name"]: r for r in body["results"]}
    assert by_name["Lightning Bolt"]["quantity"] == 3
    assert by_name["Lightning Bolt"]["lots"] == 2
    assert by_name["Lightning Bolt"]["available"] == 3


def test_search_parses_repeated_params_as_lists() -> None:
    _inscribe()
    _inscribe(finish="foil")
    _inscribe(finish="etched")

    resp = client.get("/inventory/search?finish=foil&finish=etched")

    assert resp.status_code == 200
    assert sorted(r["finish"] for r in resp.json()["results"]) == ["etched", "foil"]


def test_search_reads_set_and_type_through_their_aliases() -> None:
    with closing(db.connect()) as conn:
        conn.execute("UPDATE cards SET type_line = 'Instant' WHERE scryfall_id = 'helix-1'")
        conn.commit()
    _inscribe()
    _inscribe(scryfall_id="helix-1")

    by_set = client.get("/inventory/search", params={"set": "LEA"}).json()
    by_type = client.get("/inventory/search", params={"type": "instant"}).json()

    assert [r["scryfall_id"] for r in by_set["results"]] == ["bolt-1"]
    assert [r["scryfall_id"] for r in by_type["results"]] == ["helix-1"]


@pytest.mark.parametrize(
    "params",
    [
        {"finish": "shiny"},
        {"colors": "P"},
        {"color_identity": "X"},
        {"condition": "MINT"},
        {"sort": "price"},
        {"order": "sideways"},
        {"limit": 0},
        {"limit": 201},
        {"offset": -1},
    ],
)
def test_search_rejects_bad_params(params: dict[str, Any]) -> None:
    assert client.get("/inventory/search", params=params).status_code == 422


@pytest.mark.parametrize(
    "params",
    [
        {"name": "helix"},
        {"colors": "W"},
        {"color_identity": "W"},
        {"tag": "burn"},
        {"location": "Box A"},
        {"condition": "LP"},
        {"limit": 1},
        {"offset": 1},
    ],
)
def test_search_forwards_each_filter_param(params: dict[str, Any]) -> None:
    with closing(db.connect()) as conn:
        _insert_card(conn, "plains-1", "Plains Walker", colors='["W"]', color_identity='["W"]')
        # color_identity is "fits within", so colorless cards match W too. A blue
        # card is what makes that case exclude something.
        _insert_card(conn, "island-1", "Island Walker", colors='["U"]', color_identity='["U"]')
        conn.commit()
    _inscribe(scryfall_id="bolt-1", quantity=3, condition="LP", location="Box A", tags=["burn"])
    _inscribe(scryfall_id="helix-1", finish="foil")
    _inscribe(scryfall_id="1")
    _inscribe(scryfall_id="plains-1")
    _inscribe(scryfall_id="island-1")

    unfiltered = client.get("/inventory/search").json()
    resp = client.get("/inventory/search", params=params)

    assert resp.status_code == 200
    body = resp.json()
    if "limit" in params:
        assert len(body["results"]) == 1
    elif "offset" in params:
        assert len(body["results"]) == unfiltered["total"] - 1
    else:
        assert 0 < body["total"] < unfiltered["total"]


def test_search_forwards_sort_and_order() -> None:
    _inscribe(scryfall_id="bolt-1")
    _inscribe(scryfall_id="helix-1")
    _inscribe(scryfall_id="1")

    body = client.get("/inventory/search", params={"sort": "name", "order": "desc"}).json()

    names = [r["card"]["name"] for r in body["results"]]
    assert names[0] == max(names)
    assert names == sorted(names, reverse=True)


def test_search_blank_list_params_are_ignored() -> None:
    _inscribe(location="Box A", tags=["burn"])
    _inscribe(scryfall_id="helix-1")

    unfiltered = client.get("/inventory/search").json()
    blank = client.get("/inventory/search?set=&tag=&location=")

    assert blank.status_code == 200
    assert unfiltered["total"] == 2
    assert blank.json()["total"] == unfiltered["total"]


def test_search_route_not_shadowed_by_lot_id() -> None:
    """/inventory/search reaches the search, not the integer /{lot_id} lookup."""
    _inscribe()

    resp = client.get("/inventory/search")

    assert resp.status_code == 200
    assert resp.json()["total"] == 1


@pytest.mark.parametrize("order", [None, "asc", "desc"])
@pytest.mark.parametrize("sort", ["added", "name", "set", "quantity"])
def test_search_route_orders_like_search_folios(
    sort: inventory.SortKey, order: inventory.SortOrder | None
) -> None:
    _inscribe(scryfall_id="helix-1")
    _inscribe(scryfall_id="bolt-1", quantity=3)
    _inscribe(scryfall_id="1", quantity=2)
    _inscribe(scryfall_id="bolt-1", finish="foil")
    params = {"sort": sort} if order is None else {"sort": sort, "order": order}

    body = client.get("/inventory/search", params=params).json()
    with closing(db.connect()) as conn:
        expected, _ = inventory.search_folios(
            conn, inventory.SearchFilters(), sort=sort, order=order
        )

    assert [(r["scryfall_id"], r["finish"]) for r in body["results"]] == [
        (r["scryfall_id"], r["finish"]) for r in expected
    ]


def test_search_colors_and_color_identity_together_intersect() -> None:
    with closing(db.connect()) as conn:
        conn.execute(
            "UPDATE cards SET colors = '[\"R\"]', color_identity = '[\"R\"]' "
            "WHERE scryfall_id = 'bolt-1'"
        )
        conn.execute(
            'UPDATE cards SET colors = \'["R","W"]\', color_identity = \'["R","W"]\' '
            "WHERE scryfall_id = 'helix-1'"
        )
        _insert_card(conn, "plains-1", "Plains Walker", colors='["W"]', color_identity='["W"]')
        _insert_card(conn, "island-1", "Island Walker", colors='["U"]', color_identity='["U"]')
        conn.commit()
    for scryfall_id in ("bolt-1", "helix-1", "1", "plains-1", "island-1"):
        _inscribe(scryfall_id=scryfall_id)

    def ids(params: dict[str, str]) -> set[str]:
        body = client.get("/inventory/search", params=params).json()
        return {r["scryfall_id"] for r in body["results"]}

    # Helix contains W but does not fit in it; the colorless "1" fits but has no W.
    assert ids({"colors": "W"}) == {"plains-1", "helix-1"}
    assert ids({"color_identity": "W"}) == {"plains-1", "1"}
    assert ids({"colors": "W", "color_identity": "W"}) == {"plains-1"}


def test_search_offset_past_the_end_is_empty_with_the_total() -> None:
    _inscribe()
    _inscribe(scryfall_id="helix-1")

    resp = client.get("/inventory/search", params={"offset": 50})

    assert resp.status_code == 200
    assert (resp.json()["results"], resp.json()["total"]) == ([], 2)


def test_facets_returns_sets_locations_and_tags() -> None:
    _inscribe(location="Box A", tags=["burn"])
    _inscribe(location="box a", tags=["burn", "trade"])

    resp = client.get("/inventory/facets")

    assert resp.status_code == 200
    assert resp.json() == {
        "sets": [{"set_code": "lea", "set_name": "Test Set", "folios": 1}],
        "locations": [{"location": "Box A", "folios": 1}],
        "tags": [{"tag": "burn", "folios": 1}, {"tag": "trade", "folios": 1}],
    }


def test_facets_route_not_shadowed_by_lot_id() -> None:
    """/inventory/facets reaches the facets, not the integer /{lot_id} lookup."""
    resp = client.get("/inventory/facets")

    assert resp.status_code == 200
    assert resp.json() == {"sets": [], "locations": [], "tags": []}
