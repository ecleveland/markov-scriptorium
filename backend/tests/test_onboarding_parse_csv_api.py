"""Tests for the CSV parse endpoint (VEG-415).

POST /onboarding/parse-csv turns a pasted/uploaded CSV into normalized entries
plus per-row problems. Catalog-free (the source set/ID pins are resolved later),
so no seeding; the module-level client never enters the lifespan, so no network.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from scriptorium.main import app

client = TestClient(app)

_MANABOX = (
    "Name,Set code,Set name,Collector number,Foil,Rarity,Quantity,"
    "Scryfall ID,Condition,Language\n"
    "Lightning Bolt,2x2,Double Masters 2022,117,normal,uncommon,4,bolt-2x2,near_mint,en\n"
    "Sol Ring,cmd,Commander,256,foil,uncommon,1,sol-cmd,pristine,en\n"
)


def test_parse_csv_detects_format_and_reports_problems() -> None:
    resp = client.post("/onboarding/parse-csv", json={"text": _MANABOX})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["format"] == "manabox"
    # First row normalizes; second has an unrecognized condition → a problem.
    assert [e["name"] for e in body["entries"]] == ["Lightning Bolt"]
    assert body["entries"][0]["scryfall_id"] == "bolt-2x2"
    assert body["entries"][0]["finish"] == "nonfoil"
    assert body["entries"][0]["condition"] == "NM"
    assert len(body["problems"]) == 1
    assert body["problems"][0]["row_number"] == 2


def test_parse_csv_honors_declared_format() -> None:
    resp = client.post("/onboarding/parse-csv", json={"text": _MANABOX, "format": "manabox"})
    assert resp.status_code == 200
    assert resp.json()["format"] == "manabox"


def test_parse_csv_unknown_format_is_422_with_supported_list() -> None:
    resp = client.post("/onboarding/parse-csv", json={"text": "Foo,Bar\n1,2\n"})
    assert resp.status_code == 422
    detail = resp.json()["detail"]
    assert "supported" in detail
    assert set(detail["supported"]) == {"manabox", "deckbox", "archidekt"}
    assert detail["headers"] == ["Foo", "Bar"]


def test_parse_csv_rejects_empty_text() -> None:
    assert client.post("/onboarding/parse-csv", json={"text": ""}).status_code == 422


def test_parse_csv_rejects_unsupported_declared_format() -> None:
    resp = client.post("/onboarding/parse-csv", json={"text": _MANABOX, "format": "moxfield"})
    assert resp.status_code == 422
