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


# --- malformed / corrupt input ---------------------------------------------


def test_import_non_dict_element_raises_clean_error(
    catalog: sqlite3.Connection, tmp_path: Path
) -> None:
    """A non-object array element raises BulkImportError, not a raw TypeError."""
    import_bulk_file(catalog, _write_bulk(tmp_path / "good.json.gz", [_NORMAL_CARD]))
    bad = _write_bulk(tmp_path / "bad.json.gz", [_MINIMAL_CARD, "not-a-card"])  # type: ignore[list-item]
    with pytest.raises(BulkImportError):
        import_bulk_file(catalog, bad)
    ids = {r["scryfall_id"] for r in catalog.execute("SELECT scryfall_id FROM cards")}
    assert ids == {"edgar-1"}  # rolled back to the prior catalog


def test_import_corrupt_gzip_raises_bulk_import_error(
    catalog: sqlite3.Connection, tmp_path: Path
) -> None:
    """A corrupt .gz surfaces as BulkImportError (the documented contract), not a raw OSError."""
    import_bulk_file(catalog, _write_bulk(tmp_path / "good.json.gz", [_NORMAL_CARD]))
    corrupt = tmp_path / "corrupt.json.gz"
    corrupt.write_bytes(b"this is not gzip data")
    with pytest.raises(BulkImportError):
        import_bulk_file(catalog, corrupt)
    ids = {r["scryfall_id"] for r in catalog.execute("SELECT scryfall_id FROM cards")}
    assert ids == {"edgar-1"}


def test_import_corrupt_deflate_body_raises_bulk_import_error(
    catalog: sqlite3.Connection, tmp_path: Path
) -> None:
    """A valid gzip header with a corrupt body (zlib.error) is wrapped, not raw."""
    gz = bytearray(gzip.compress(json.dumps([_NORMAL_CARD]).encode()))
    for i in range(10, 20):  # mangle the deflate stream, leaving the 10-byte header intact
        gz[i] ^= 0xFF
    path = tmp_path / "deflate-corrupt.json.gz"
    path.write_bytes(bytes(gz))
    with pytest.raises(BulkImportError):
        import_bulk_file(catalog, path)


def test_import_truncated_json_raises_bulk_import_error(
    catalog: sqlite3.Connection, tmp_path: Path
) -> None:
    """A valid gzip wrapping truncated JSON surfaces as BulkImportError."""
    path = tmp_path / "truncated.json.gz"
    path.write_bytes(gzip.compress(b'[{"id":"x","name":"X"'))  # cut off mid-object
    with pytest.raises(BulkImportError):
        import_bulk_file(catalog, path)


def test_import_duplicate_id_raises_bulk_import_error(
    catalog: sqlite3.Connection, tmp_path: Path
) -> None:
    """A PRIMARY KEY collision from executemany is wrapped as BulkImportError."""
    path = _write_bulk(tmp_path / "dupe.json.gz", [_NORMAL_CARD, dict(_NORMAL_CARD)])
    with pytest.raises(BulkImportError):
        import_bulk_file(catalog, path)
    assert _count(catalog, "cards") == 0  # rolled back; nothing committed


def test_import_atomic_under_autocommit_connection(tmp_path: Path) -> None:
    """The full-replace stays atomic even on an autocommit=True connection.

    Guards the importer's own-the-transaction design: if it relied on the
    connection's isolation mode instead, a mid-import failure here would leave
    the catalog permanently emptied.
    """
    db_file = tmp_path / "catalog.db"
    # Build the schema with a normal connection first.
    with closing(sqlite3.connect(db_file)) as setup:
        apply_migrations(setup)

    conn = sqlite3.connect(db_file, autocommit=True)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    with closing(conn):
        import_bulk_file(conn, _write_bulk(tmp_path / "good.json.gz", [_NORMAL_CARD]))
        malformed = dict(_DFC_CARD)
        del malformed["name"]
        bad = _write_bulk(tmp_path / "bad.json.gz", [_MINIMAL_CARD, malformed])
        with pytest.raises(BulkImportError):
            import_bulk_file(conn, bad)
        ids = {r["scryfall_id"] for r in conn.execute("SELECT scryfall_id FROM cards")}
        assert ids == {"edgar-1"}  # survived despite autocommit mode


# --- batching --------------------------------------------------------------


def test_import_spans_multiple_batches_keeping_faces_with_parent(
    catalog: sqlite3.Connection, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """With a tiny batch size, cards/faces still load correctly across flushes.

    Guards the FK invariant that a card and its faces flush together — a DFC
    straddling a batch boundary must not insert faces before their parent.
    """
    monkeypatch.setattr("scriptorium.scryfall.importer._BATCH_SIZE", 2)

    def _plain(card_id: str) -> dict[str, Any]:
        return {**_MINIMAL_CARD, "id": card_id}

    # 5 cards across 3 flushes (2, 2, 1); the DFC is the 3rd, straddling a boundary.
    cards = [_plain("c1"), _plain("c2"), _DFC_CARD, _plain("c4"), _plain("c5")]
    result = import_bulk_file(catalog, _write_bulk(tmp_path / "many.json.gz", cards))
    assert result == ImportResult(cards=5, faces=2)
    assert _count(catalog, "cards") == 5
    faces = catalog.execute(
        "SELECT face_index, name FROM card_faces WHERE scryfall_id = 'dfc-1' ORDER BY face_index"
    ).fetchall()
    assert [f["name"] for f in faces] == ["Delver of Secrets", "Insectile Aberration"]


def test_import_stores_fractional_cmc_as_real(catalog: sqlite3.Connection, tmp_path: Path) -> None:
    """cmc round-trips as a float, not decimal.Decimal — pins the use_float=True choice."""
    card = {**_MINIMAL_CARD, "id": "half", "cmc": 0.5}
    import_bulk_file(catalog, _write_bulk(tmp_path / "half.json.gz", [card]))
    row = catalog.execute(
        "SELECT typeof(cmc) AS t, cmc FROM cards WHERE scryfall_id = 'half'"
    ).fetchone()
    assert row["t"] == "real"
    assert row["cmc"] == 0.5
