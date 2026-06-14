"""Tests for the root greeting and health endpoints."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from scriptorium.main import app

client = TestClient(app)


def test_root_returns_greeting() -> None:
    resp = client.get("/")
    assert resp.status_code == 200
    assert "Scriptorium" in resp.json()["message"]


def test_health_reports_ok(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    # Point the catalog at a throwaway file so the test never touches real data.
    monkeypatch.setenv("SCRIPTORIUM_DB_PATH", str(tmp_path / "test.db"))
    resp = client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["database"] == "ok"
