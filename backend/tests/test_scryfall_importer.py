"""Tests for the Scryfall bulk importer (VEG-213).

The importer stream-parses a bulk JSON array and full-replaces the cards /
card_faces tables. Tests build a tiny gzipped bulk file (a stand-in for the
~110k-card export) and load it into a freshly-migrated tmp catalog — no network.
"""

from __future__ import annotations

import gzip
import json
import sqlite3
from collections.abc import Iterator
from contextlib import closing
from pathlib import Path
from typing import Any

import pytest

from scriptorium import db
from scriptorium.migrations import apply_migrations
from scriptorium.scryfall.importer import BulkImportError, ImportResult, import_bulk_file

# --- fixture card objects (trimmed Scryfall shapes) ------------------------

_NORMAL_CARD: dict[str, Any] = {
    "id": "edgar-1",
    "oracle_id": "oracle-edgar",
    "name": "Edgar Markov",
    "set": "mm3",
    "set_name": "Modern Masters 2017",
    "collector_number": "128",
    "rarity": "mythic",
    "lang": "en",
    "released_at": "2017-03-17",
    "layout": "normal",
    "mana_cost": "{3}{R}{W}{B}",
    "cmc": 6.0,
    "type_line": "Legendary Creature — Vampire Knight",
    "oracle_text": "Eminence —",
    "colors": ["B", "R", "W"],
    "color_identity": ["B", "R", "W"],
    "finishes": ["nonfoil", "foil"],
    "legalities": {"commander": "legal", "modern": "not_legal"},
    "image_uris": {"normal": "https://img/edgar.jpg"},
    "prices": {"usd": "12.34", "usd_foil": "30.00", "eur": "10.50", "tix": None},
    "scryfall_uri": "https://scryfall.com/card/mm3/128",
}

_DFC_CARD: dict[str, Any] = {
    "id": "dfc-1",
    "oracle_id": "oracle-dfc",
    "name": "Delver of Secrets // Insectile Aberration",
    "set": "mid",
    "set_name": "Innistrad: Midnight Hunt",
    "collector_number": "47",
    "rarity": "common",
    "lang": "en",
    "released_at": "2021-09-24",
    "layout": "transform",
    "cmc": 1.0,
    "color_identity": ["U"],
    "finishes": ["nonfoil", "foil"],
    "legalities": {"modern": "legal"},
    # No top-level mana_cost / oracle_text / image_uris — those live per-face.
    "prices": {"usd": "0.20"},
    "scryfall_uri": "https://scryfall.com/card/mid/47",
    "card_faces": [
        {
            "name": "Delver of Secrets",
            "mana_cost": "{U}",
            "type_line": "Creature — Human Wizard",
            "oracle_text": "At the beginning of your upkeep, look...",
            "colors": ["U"],
            "image_uris": {"normal": "https://img/delver-front.jpg"},
        },
        {
            "name": "Insectile Aberration",
            "mana_cost": "",
            "type_line": "Creature — Human Insect",
            "oracle_text": "Flying",
            "colors": ["U"],
            "image_uris": {"normal": "https://img/delver-back.jpg"},
        },
    ],
}

_MINIMAL_CARD: dict[str, Any] = {
    # Only the NOT NULL columns; everything optional omitted (no prices/colors).
    "id": "minimal-1",
    "name": "Plains",
    "set": "lea",
    "set_name": "Limited Edition Alpha",
    "collector_number": "295",
    "rarity": "common",
    "lang": "en",
    "layout": "normal",
}


def _write_bulk(path: Path, cards: list[dict[str, Any]], *, gzipped: bool = True) -> Path:
    raw = json.dumps(cards).encode()
    if gzipped:
        path.write_bytes(gzip.compress(raw))
    else:
        path.write_bytes(raw)
    return path


@pytest.fixture
def catalog(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[sqlite3.Connection]:
    """A migrated catalog opened the way the app opens it (FK enforcement on)."""
    monkeypatch.setenv("SCRIPTORIUM_DB_PATH", str(tmp_path / "catalog.db"))
    conn = db.connect()
    apply_migrations(conn)
    with closing(conn):
        yield conn


def _count(conn: sqlite3.Connection, table: str) -> int:
    return int(conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])


# --- happy path ------------------------------------------------------------


def test_import_loads_all_cards_and_faces(catalog: sqlite3.Connection, tmp_path: Path) -> None:
    path = _write_bulk(tmp_path / "bulk.json.gz", [_NORMAL_CARD, _DFC_CARD, _MINIMAL_CARD])
    result = import_bulk_file(catalog, path)
    assert result == ImportResult(cards=3, faces=2)
    assert _count(catalog, "cards") == 3
    assert _count(catalog, "card_faces") == 2


def test_import_maps_scalar_and_json_columns(catalog: sqlite3.Connection, tmp_path: Path) -> None:
    path = _write_bulk(tmp_path / "bulk.json.gz", [_NORMAL_CARD])
    import_bulk_file(catalog, path)
    row = catalog.execute(
        "SELECT set_code, cmc, colors, legalities, price_usd, price_usd_foil, price_tix "
        "FROM cards WHERE scryfall_id = 'edgar-1'"
    ).fetchone()
    assert row["set_code"] == "mm3"
    assert row["cmc"] == 6.0
    assert json.loads(row["colors"]) == ["B", "R", "W"]
    assert json.loads(row["legalities"])["commander"] == "legal"
    assert row["price_usd"] == "12.34"
    assert row["price_usd_foil"] == "30.00"
    assert row["price_tix"] is None


def test_import_writes_faces_in_order_with_null_top_level(
    catalog: sqlite3.Connection, tmp_path: Path
) -> None:
    path = _write_bulk(tmp_path / "bulk.json.gz", [_DFC_CARD])
    import_bulk_file(catalog, path)
    # Multifaced: top-level image_uris is NULL; faces carry their own.
    assert (
        catalog.execute("SELECT image_uris FROM cards WHERE scryfall_id = 'dfc-1'").fetchone()[
            "image_uris"
        ]
        is None
    )
    faces = catalog.execute(
        "SELECT face_index, name, image_uris FROM card_faces "
        "WHERE scryfall_id = 'dfc-1' ORDER BY face_index"
    ).fetchall()
    assert [f["face_index"] for f in faces] == [0, 1]
    assert faces[0]["name"] == "Delver of Secrets"
    assert faces[1]["name"] == "Insectile Aberration"
    assert json.loads(faces[0]["image_uris"])["normal"] == "https://img/delver-front.jpg"


def test_import_leaves_optional_columns_null(catalog: sqlite3.Connection, tmp_path: Path) -> None:
    path = _write_bulk(tmp_path / "bulk.json.gz", [_MINIMAL_CARD])
    import_bulk_file(catalog, path)
    row = catalog.execute(
        "SELECT oracle_id, mana_cost, colors, image_uris, price_usd "
        "FROM cards WHERE scryfall_id = 'minimal-1'"
    ).fetchone()
    assert row["oracle_id"] is None
    assert row["mana_cost"] is None
    assert row["colors"] is None
    assert row["image_uris"] is None
    assert row["price_usd"] is None


# --- replace / idempotency / atomicity -------------------------------------


def test_import_full_replaces_stale_rows(catalog: sqlite3.Connection, tmp_path: Path) -> None:
    catalog.execute(
        "INSERT INTO cards (scryfall_id, name, set_code, set_name, collector_number, "
        "rarity, lang, layout, color_identity, finishes) VALUES "
        "('stale-1', 'Old Card', 'old', 'Old Set', '1', 'common', 'en', 'normal', '[]', '[]')"
    )
    catalog.commit()
    path = _write_bulk(tmp_path / "bulk.json.gz", [_NORMAL_CARD])
    import_bulk_file(catalog, path)
    ids = {r["scryfall_id"] for r in catalog.execute("SELECT scryfall_id FROM cards")}
    assert ids == {"edgar-1"}  # stale card gone


def test_import_is_idempotent(catalog: sqlite3.Connection, tmp_path: Path) -> None:
    path = _write_bulk(tmp_path / "bulk.json.gz", [_NORMAL_CARD, _DFC_CARD])
    first = import_bulk_file(catalog, path)
    second = import_bulk_file(catalog, path)
    assert first == second == ImportResult(cards=2, faces=2)
    assert _count(catalog, "cards") == 2
    assert _count(catalog, "card_faces") == 2


def test_import_rolls_back_on_malformed_card(catalog: sqlite3.Connection, tmp_path: Path) -> None:
    # Pre-existing good data that the failed import must not destroy.
    good = _write_bulk(tmp_path / "good.json.gz", [_NORMAL_CARD])
    import_bulk_file(catalog, good)

    malformed = dict(_DFC_CARD)
    del malformed["name"]  # required NOT NULL column
    bad = _write_bulk(tmp_path / "bad.json.gz", [_MINIMAL_CARD, malformed])
    with pytest.raises(BulkImportError):
        import_bulk_file(catalog, bad)
    # Transaction rolled back: the original catalog is intact, not half-replaced.
    ids = {r["scryfall_id"] for r in catalog.execute("SELECT scryfall_id FROM cards")}
    assert ids == {"edgar-1"}


# --- input handling --------------------------------------------------------


def test_import_reads_plain_json(catalog: sqlite3.Connection, tmp_path: Path) -> None:
    path = _write_bulk(tmp_path / "bulk.json", [_NORMAL_CARD], gzipped=False)
    result = import_bulk_file(catalog, path)
    assert result.cards == 1


def test_import_missing_file_raises(catalog: sqlite3.Connection, tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError):
        import_bulk_file(catalog, tmp_path / "nope.json.gz")
