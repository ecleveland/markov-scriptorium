"""Tests for the decklist parse endpoint (VEG-414).

POST /onboarding/parse turns pasted decklist text into structured entries plus
per-line problems. It is catalog-free (pure text), so no seeding is needed; the
module-level client never enters the lifespan, so no background refresh fires.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from scriptorium.main import app

client = TestClient(app)


def test_parse_returns_entries_and_problems() -> None:
    text = "\n".join(
        [
            "# Burn",
            "4 Lightning Bolt (2X2) 117",
            "2 Shock",
            "Sideboard",
            "4",  # quantity with no name -> problem
        ]
    )
    resp = client.post("/onboarding/parse", json={"text": text})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert [(e["name"], e["quantity"]) for e in body["entries"]] == [
        ("Lightning Bolt", 4),
        ("Shock", 2),
    ]
    assert body["entries"][0]["set_code"] == "2X2"
    assert body["entries"][0]["collector_number"] == "117"
    assert len(body["problems"]) == 1
    assert body["problems"][0]["line_number"] == 5
    assert body["problems"][0]["text"] == "4"


def test_parse_rejects_empty_text() -> None:
    assert client.post("/onboarding/parse", json={"text": ""}).status_code == 422
