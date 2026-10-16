"""Tests for the archive endpoints (VEG-281, ADR 0023).

Seed a tmp catalog, then drive the endpoints through the FastAPI TestClient.
The module-level client is used without a `with` block, so the lifespan (and its
background refresh) never fires, and no network is touched.
"""

from __future__ import annotations

import csv
import io
import sqlite3
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from scriptorium import archive, db
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
def seeded_catalog(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setenv("SCRIPTORIUM_DB_PATH", str(tmp_path / "catalog.db"))
    monkeypatch.delenv(archive.BACKUP_KEEP_ENV, raising=False)
    with closing(db.connect()) as conn:
        apply_migrations(conn)
        _insert_card(conn, "bolt-1", "Lightning Bolt", set_code="lea")
        conn.execute(
            "INSERT INTO inventory (scryfall_id, quantity, finish) VALUES ('bolt-1', 2, 'foil')"
        )
        conn.execute("INSERT INTO decks (name) VALUES ('Edgar''s Court')")
        conn.execute(
            "INSERT INTO deck_cards (deck_id, scryfall_id, quantity) VALUES (1, 'bolt-1', 4)"
        )
        conn.commit()
    return tmp_path


def _today() -> str:
    return datetime.now(UTC).strftime("%Y%m%d")


def test_post_backup_then_list_shows_it_with_directory_and_keep(seeded_catalog: Path) -> None:
    created = client.post("/archive/backups")
    assert created.status_code == 201, created.text
    backup = created.json()
    assert backup["reason"] == "manual"
    assert backup["schema_version"] == 6
    assert backup["filename"].endswith("-v6-manual.db")
    assert Path(backup["path"]).is_file()

    listed = client.get("/archive/backups")
    assert listed.status_code == 200
    body = listed.json()
    assert body["directory"] == str(seeded_catalog / "backups")
    assert body["keep"] == 3
    assert body["premigration_keep"] == 2
    assert body["backups"] == [backup]


def test_post_backup_409_while_write_lock_held(seeded_catalog: Path) -> None:
    with closing(sqlite3.connect(db.db_path())) as writer:
        writer.execute("BEGIN IMMEDIATE")
        resp = client.post("/archive/backups")
        writer.rollback()

    assert resp.status_code == 409
    assert "scribes" in resp.json()["detail"]
    assert client.get("/archive/backups").json()["backups"] == []


def test_post_backup_retries_once_on_same_second_collision(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    backup = archive.Backup(
        filename="scriptorium-20261015T142234Z-v6-manual.db",
        path="/backups/scriptorium-20261015T142234Z-v6-manual.db",
        reason="manual",
        created_at="2026-10-15T14:22:34Z",
        schema_version=6,
        size_bytes=4096,
    )
    calls: list[str] = []
    sleeps: list[float] = []

    def collide_then_succeed(reason: archive.Reason) -> archive.Backup:
        calls.append(reason)
        if len(calls) == 1:
            raise archive.BackupCollisionError("a backup with that name already exists")
        return backup

    monkeypatch.setattr(archive, "take_backup", collide_then_succeed)
    monkeypatch.setattr("scriptorium.api.archive.time.sleep", sleeps.append)

    resp = client.post("/archive/backups")

    assert resp.status_code == 201, resp.text
    assert resp.json()["filename"] == backup.filename
    assert calls == ["manual", "manual"]
    assert sleeps == [1]


def test_post_backup_500_on_generic_backup_error(monkeypatch: pytest.MonkeyPatch) -> None:
    def fail(reason: archive.Reason) -> archive.Backup:
        raise archive.BackupError("backup copy failed: boom")

    monkeypatch.setattr(archive, "take_backup", fail)

    resp = client.post("/archive/backups")

    assert resp.status_code == 500
    assert resp.json()["detail"] == "backup copy failed: boom"


def test_post_backup_500_detail_names_the_os_error(monkeypatch: pytest.MonkeyPatch) -> None:
    def read_only(*args: object, **kwargs: object) -> tuple[int, str]:
        raise PermissionError("read-only")

    monkeypatch.setattr("scriptorium.archive.tempfile.mkstemp", read_only)

    resp = client.post("/archive/backups")

    assert resp.status_code == 500
    assert "read-only" in resp.json()["detail"]


def test_export_csv_is_attachment() -> None:
    resp = client.get("/archive/export.csv")

    assert resp.status_code == 200
    assert resp.headers["content-type"] == "text/csv; charset=utf-8"
    assert (
        resp.headers["content-disposition"] == f'attachment; filename="scriptorium-{_today()}.csv"'
    )
    rows = list(csv.DictReader(io.StringIO(resp.text)))
    assert [(r["Scryfall ID"], r["Quantity"], r["Foil"]) for r in rows] == [("bolt-1", "2", "foil")]


def test_export_json_is_attachment() -> None:
    resp = client.get("/archive/export.json")

    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/json"
    assert (
        resp.headers["content-disposition"] == f'attachment; filename="scriptorium-{_today()}.json"'
    )
    body = resp.json()
    assert body["format"] == "markov-scriptorium-export"
    assert [lot["scryfall_id"] for lot in body["inventory"]] == ["bolt-1"]
    assert [tome["name"] for tome in body["tomes"]] == ["Edgar's Court"]
    assert body["tomes"][0]["slots"][0]["quantity"] == 4
