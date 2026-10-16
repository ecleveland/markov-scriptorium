"""Tests for catalog backups and exports (VEG-281, ADR 0023).

Each test points the catalog at a tmp file, migrates it, and seeds two cards,
one lot and one Tome with two slots through raw SQL. Backups land in a
``backups`` directory beside that tmp file.
"""

from __future__ import annotations

import csv
import io
import json
import sqlite3
from collections.abc import Iterator
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path

import pytest

from scriptorium import archive, db
from scriptorium.archive import BackupBusyError, BackupError
from scriptorium.migrations import apply_migrations
from scriptorium.onboarding.csv_import import parse_csv

_REQUIRED_DEFAULTS = {
    "set_code": "tst",
    "set_name": "Test Set",
    "collector_number": "1",
    "rarity": "common",
    "lang": "en",
    "layout": "normal",
}

_CSV_HEADER = (
    "Name,Set code,Set name,Collector number,Foil,Rarity,Quantity,Scryfall ID,"
    "Condition,Language,Location,Notes,Tags,Acquired at,Price paid"
)

_STAMP = datetime(2026, 10, 15, 14, 22, 33, tzinfo=UTC)


def _insert_card(
    conn: sqlite3.Connection, scryfall_id: str, name: str, **overrides: object
) -> None:
    cols = {"scryfall_id": scryfall_id, "name": name, **_REQUIRED_DEFAULTS, **overrides}
    placeholders = ", ".join("?" for _ in cols)
    conn.execute(
        f"INSERT INTO cards ({', '.join(cols)}) VALUES ({placeholders})",
        tuple(cols.values()),
    )


def _insert_lot(conn: sqlite3.Connection, scryfall_id: str, **fields: object) -> int:
    cols = {"scryfall_id": scryfall_id, **fields}
    placeholders = ", ".join("?" for _ in cols)
    cur = conn.execute(
        f"INSERT INTO inventory ({', '.join(cols)}) VALUES ({placeholders})",
        tuple(cols.values()),
    )
    assert cur.lastrowid is not None
    return cur.lastrowid


def _insert_tome(conn: sqlite3.Connection, name: str, **fields: object) -> int:
    cols = {"name": name, **fields}
    placeholders = ", ".join("?" for _ in cols)
    cur = conn.execute(
        f"INSERT INTO decks ({', '.join(cols)}) VALUES ({placeholders})",
        tuple(cols.values()),
    )
    assert cur.lastrowid is not None
    return cur.lastrowid


def _insert_slot(
    conn: sqlite3.Connection, deck_id: int, scryfall_id: str, **fields: object
) -> None:
    cols = {"deck_id": deck_id, "scryfall_id": scryfall_id, **fields}
    placeholders = ", ".join("?" for _ in cols)
    conn.execute(
        f"INSERT INTO deck_cards ({', '.join(cols)}) VALUES ({placeholders})",
        tuple(cols.values()),
    )


def _seed(conn: sqlite3.Connection) -> None:
    _insert_card(conn, "bolt-1", "Lightning Bolt", set_code="lea", set_name="Alpha")
    _insert_card(conn, "helix-1", "Lightning Helix", collector_number="218", rarity="uncommon")
    _insert_lot(
        conn,
        "bolt-1",
        quantity=2,
        finish="foil",
        condition="LP",
        location="Volume I",
        notes="from the estate sale",
        price_paid="1.50",
        acquired_at="2026-09-01",
        tags=json.dumps(["foo", "bar"]),
    )
    deck_id = _insert_tome(conn, "Edgar's Court", format="commander", notes="blood first")
    _insert_slot(conn, deck_id, "bolt-1", board="main", quantity=4)
    _insert_slot(conn, deck_id, "helix-1", board="sideboard", finish="foil", quantity=1)


@pytest.fixture
def catalog(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Path]:
    """A migrated tmp catalog with the empty collection; yields its directory."""
    monkeypatch.setenv("SCRIPTORIUM_DB_PATH", str(tmp_path / "catalog.db"))
    monkeypatch.delenv(archive.BACKUP_KEEP_ENV, raising=False)
    with closing(db.connect()) as conn:
        apply_migrations(conn)
        conn.commit()
    yield tmp_path


@pytest.fixture
def seeded(catalog: Path) -> Path:
    """The tmp catalog with two cards, one lot and one Tome with two slots."""
    with closing(db.connect()) as conn:
        _seed(conn)
        conn.commit()
    return catalog


def _user_version(conn: sqlite3.Connection) -> int:
    return int(conn.execute("PRAGMA user_version").fetchone()[0])


# --- backups ---------------------------------------------------------------


def test_backup_is_readable_copy_with_user_rows_and_version(seeded: Path) -> None:
    backup = archive.take_backup("manual")

    path = Path(backup.path)
    assert path.parent == seeded / "backups"
    assert path.is_file()
    assert backup.size_bytes == path.stat().st_size
    with closing(sqlite3.connect(path)) as copy:
        assert _user_version(copy) == backup.schema_version == 6
        assert copy.execute("SELECT count(*) FROM inventory").fetchone()[0] == 1
        assert copy.execute("SELECT count(*) FROM decks").fetchone()[0] == 1
        assert copy.execute("SELECT count(*) FROM deck_cards").fetchone()[0] == 2
        assert copy.execute("PRAGMA quick_check").fetchone()[0] == "ok"


def test_backup_filename_carries_utc_stamp_version_and_reason(seeded: Path) -> None:
    backup = archive.take_backup("premigration", now=_STAMP)

    assert backup.filename == "scriptorium-20261015T142233Z-v6-premigration.db"
    assert backup.reason == "premigration"
    assert backup.created_at == "2026-10-15T14:22:33Z"
    assert [b.filename for b in archive.list_backups()] == [backup.filename]
    assert archive.list_backups()[0] == backup


def test_backup_rejects_same_second_collision(seeded: Path) -> None:
    first = archive.take_backup("manual", now=_STAMP)
    before = Path(first.path).read_bytes()

    with pytest.raises(archive.BackupCollisionError):
        archive.take_backup("manual", now=_STAMP)

    # The first copy survives untouched and still reads as a valid catalog.
    assert Path(first.path).read_bytes() == before
    assert [p.name for p in (seeded / "backups").iterdir()] == [first.filename]
    with closing(sqlite3.connect(first.path)) as copy:
        assert copy.execute("PRAGMA quick_check").fetchone()[0] == "ok"
        assert copy.execute("SELECT count(*) FROM inventory").fetchone()[0] == 1


def test_failed_quick_check_leaves_no_file(seeded: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(archive, "_verify", lambda path: "malformed")

    with pytest.raises(BackupError, match="malformed"):
        archive.take_backup("manual", now=_STAMP)

    assert list((seeded / "backups").iterdir()) == []


def test_vanished_temp_file_fails_verification_instead_of_publishing_empty_copy(
    seeded: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Simulate a concurrent same-second backup that moved this attempt's temp
    # file away before verification. Verifying must not create an empty file.
    real_verify = archive._verify
    seen: list[Path] = []

    def vanish_then_verify(path: Path) -> str:
        seen.append(path)
        path.unlink()
        return real_verify(path)

    monkeypatch.setattr(archive, "_verify", vanish_then_verify)

    with pytest.raises(BackupError):
        archive.take_backup("manual", now=_STAMP)

    [tmp] = seen
    filename = "scriptorium-20261015T142233Z-v6-manual.db"
    assert tmp.name.startswith(f".{filename}.")
    assert tmp.name.endswith(".tmp")
    assert tmp.name != f".{filename}.tmp"  # unique per attempt
    assert list((seeded / "backups").iterdir()) == []


def test_backup_verifies_when_the_catalog_path_has_uri_characters(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    odd = tmp_path / "Volume #1 ? 100%"
    monkeypatch.setenv("SCRIPTORIUM_DB_PATH", str(odd / "catalog.db"))
    with closing(db.connect()) as conn:
        apply_migrations(conn)

    backup = archive.take_backup("manual")

    assert Path(backup.path).parent == odd / "backups"
    assert Path(backup.path).is_file()
    # SQLite would read "#" and "?" as URI syntax and open a truncated path
    # read-write. Verifying a missing file there must raise and create nothing.
    with pytest.raises(sqlite3.Error):
        archive._verify(odd / "backups" / "missing.db")
    assert [p.name for p in tmp_path.iterdir()] == [odd.name]


def test_busy_limit_raises_on_21st_consecutive_busy() -> None:
    limit = archive._BusyLimit()
    for status in [sqlite3.SQLITE_BUSY, sqlite3.SQLITE_LOCKED] * 10:
        limit(status, 10, 20)

    with pytest.raises(BackupBusyError):
        limit(sqlite3.SQLITE_BUSY, 10, 20)


def test_busy_limit_resets_after_a_step_that_copies() -> None:
    limit = archive._BusyLimit()
    for _ in range(20):
        limit(sqlite3.SQLITE_BUSY, 10, 20)
    limit(sqlite3.SQLITE_OK, 5, 20)

    for _ in range(20):
        limit(sqlite3.SQLITE_BUSY, 5, 20)  # 20 more after the reset, still under the cap


def test_copy_that_stays_busy_raises_busy_and_leaves_no_file(
    seeded: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    class AlwaysBusy:
        def __call__(self, status: int, remaining: int, total: int) -> None:
            raise BackupBusyError("still locked")

    monkeypatch.setattr(archive, "_BusyLimit", AlwaysBusy)

    with pytest.raises(BackupBusyError):
        archive.take_backup("manual", now=_STAMP)

    assert list((seeded / "backups").iterdir()) == []


def test_has_premigration_backup_matches_reason_and_version(catalog: Path) -> None:
    backups = archive.backups_dir()
    (backups / "scriptorium-20260101T000000Z-v5-manual.db").write_bytes(b"x")
    (backups / "scriptorium-20260101T000000Z-v4-premigration.db").write_bytes(b"x")
    assert archive.has_premigration_backup(5) is False

    (backups / "scriptorium-20260102T000000Z-v5-premigration.db").write_bytes(b"x")
    assert archive.has_premigration_backup(5) is True


def test_prune_keeps_manual_and_premigration_pools_separately(catalog: Path) -> None:
    backups = archive.backups_dir()
    manual = [f"scriptorium-2026101{day}T120000Z-v6-manual.db" for day in range(1, 6)]
    premigration = [f"scriptorium-2026100{day}T120000Z-v5-premigration.db" for day in range(1, 5)]
    for name in [*manual, *premigration, "notes.txt"]:
        (backups / name).write_bytes(b"x")

    removed = archive.prune_backups()

    remaining = sorted(p.name for p in backups.iterdir())
    assert remaining == sorted([*manual[-3:], *premigration[-2:], "notes.txt"])
    assert sorted(p.name for p in removed) == sorted([*manual[:2], *premigration[:2]])


def test_prune_honors_backup_keep_env(catalog: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(archive.BACKUP_KEEP_ENV, "4")
    backups = archive.backups_dir()
    manual = [f"scriptorium-2026101{day}T120000Z-v6-manual.db" for day in range(1, 7)]
    for name in manual:
        (backups / name).write_bytes(b"x")

    removed = archive.prune_backups()

    assert sorted(p.name for p in backups.iterdir()) == manual[-4:]
    assert sorted(p.name for p in removed) == manual[:2]


def test_manual_keep_reads_env_and_rejects_garbage(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(archive.BACKUP_KEEP_ENV, raising=False)
    assert archive.manual_keep() == archive.DEFAULT_KEEP == 3

    monkeypatch.setenv(archive.BACKUP_KEEP_ENV, "7")
    assert archive.manual_keep() == 7

    for garbage in ["", "zero", "0", "-2", "2.5"]:
        monkeypatch.setenv(archive.BACKUP_KEEP_ENV, garbage)
        assert archive.manual_keep() == 3, garbage


def test_busy_source_raises_backup_busy_error(seeded: Path) -> None:
    with closing(sqlite3.connect(db.db_path())) as writer:
        writer.execute("BEGIN IMMEDIATE")
        with pytest.raises(BackupBusyError):
            archive.take_backup("manual")
        writer.rollback()

    backups = seeded / "backups"
    assert not backups.exists() or list(backups.iterdir()) == []


def test_backup_succeeds_while_a_reader_is_open(seeded: Path) -> None:
    with closing(sqlite3.connect(db.db_path())) as reader:
        cursor = reader.execute("SELECT scryfall_id FROM cards ORDER BY scryfall_id")
        assert cursor.fetchone() is not None  # one row left, so the statement stays open

        backup = archive.take_backup("manual")

        assert cursor.fetchone() is not None
    assert Path(backup.path).is_file()


def test_has_user_data_false_on_fresh_true_after_lot_or_tome(catalog: Path) -> None:
    with closing(sqlite3.connect(catalog / "unmigrated.db")) as bare:
        assert archive.has_user_data(bare) is False

    with closing(db.connect()) as conn:
        assert archive.has_user_data(conn) is False

        _insert_card(conn, "bolt-1", "Lightning Bolt")
        assert archive.has_user_data(conn) is False  # catalog cards are not user data

        lot = _insert_lot(conn, "bolt-1")
        assert archive.has_user_data(conn) is True

        conn.execute("DELETE FROM inventory WHERE id = ?", (lot,))
        _insert_tome(conn, "Edgar's Court")
        assert archive.has_user_data(conn) is True


# --- CSV export ------------------------------------------------------------


def test_csv_header_and_vocabulary(seeded: Path) -> None:
    with closing(db.connect()) as conn:
        _insert_lot(conn, "helix-1", finish="nonfoil", condition="NM")
        _insert_lot(conn, "helix-1", finish="etched", condition="MP")
        _insert_lot(conn, "helix-1", finish="foil", condition="HP")
        _insert_lot(conn, "helix-1", finish="nonfoil", condition="DMG")
        conn.commit()
        text = archive.export_csv(conn)

    lines = text.split("\n")
    assert lines[0] == _CSV_HEADER
    rows = list(csv.DictReader(io.StringIO(text)))
    assert [(r["Foil"], r["Condition"]) for r in rows] == [
        ("foil", "lightly_played"),
        ("normal", "near_mint"),
        ("etched", "moderately_played"),
        ("foil", "heavily_played"),
        ("normal", "damaged"),
    ]
    first = rows[0]
    assert first == {
        "Name": "Lightning Bolt",
        "Set code": "lea",
        "Set name": "Alpha",
        "Collector number": "1",
        "Foil": "foil",
        "Rarity": "common",
        "Quantity": "2",
        "Scryfall ID": "bolt-1",
        "Condition": "lightly_played",
        "Language": "en",
        "Location": "Volume I",
        "Notes": "from the estate sale",
        "Tags": "foo;bar",
        "Acquired at": "2026-09-01",
        "Price paid": "1.50",
    }
    # A lot with no optional fields writes empty cells, never "None".
    assert rows[1]["Location"] == rows[1]["Notes"] == rows[1]["Tags"] == ""
    assert rows[1]["Acquired at"] == rows[1]["Price paid"] == ""


def test_csv_round_trips_through_parse_csv(seeded: Path) -> None:
    with closing(db.connect()) as conn:
        _insert_lot(conn, "helix-1", quantity=3, finish="etched", condition="DMG")
        conn.commit()
        text = archive.export_csv(conn)
        lots = conn.execute(
            "SELECT scryfall_id, quantity, finish, condition, language FROM inventory ORDER BY id"
        ).fetchall()

    result = parse_csv(text)

    assert result.format == "manabox"
    assert result.problems == []
    assert [
        (e.scryfall_id, e.quantity, e.finish, e.condition, e.language) for e in result.entries
    ] == [tuple(lot) for lot in lots]


def test_csv_round_trips_every_finish_and_condition(catalog: Path) -> None:
    pairs = [
        (finish, condition)
        for finish in ("nonfoil", "foil", "etched")
        for condition in ("NM", "LP", "MP", "HP", "DMG")
    ]
    with closing(db.connect()) as conn:
        _insert_card(conn, "bolt-1", "Lightning Bolt")
        for finish, condition in pairs:
            _insert_lot(conn, "bolt-1", finish=finish, condition=condition)
        conn.commit()
        text = archive.export_csv(conn)

    result = parse_csv(text)

    assert result.problems == []
    assert [(e.finish, e.condition) for e in result.entries] == pairs


def test_csv_empty_collection_is_header_only(catalog: Path) -> None:
    with closing(db.connect()) as conn:
        assert archive.export_csv(conn) == _CSV_HEADER + "\n"


# --- JSON export -----------------------------------------------------------


def test_json_shape_inventory_cards_and_tomes_with_slots(seeded: Path) -> None:
    with closing(db.connect()) as conn:
        doc = archive.export_json(conn, now=_STAMP)

    assert doc["format"] == "markov-scriptorium-export"
    assert doc["format_version"] == 1
    assert doc["exported_at"] == "2026-10-15T14:22:33Z"
    assert doc["schema_version"] == 6
    assert doc["inventory"] == [
        {
            "id": 1,
            "scryfall_id": "bolt-1",
            "quantity": 2,
            "finish": "foil",
            "condition": "LP",
            "language": "en",
            "location": "Volume I",
            "acquired_at": "2026-09-01",
            "price_paid": "1.50",
            "notes": "from the estate sale",
            "tags": ["foo", "bar"],
            "card": {
                "name": "Lightning Bolt",
                "set_code": "lea",
                "set_name": "Alpha",
                "collector_number": "1",
            },
        }
    ]
    [tome] = doc["tomes"]
    assert tome["id"] == 1
    assert tome["name"] == "Edgar's Court"
    assert tome["format"] == "commander"
    assert tome["status"] == "in_progress"
    assert tome["claims_cards"] is True
    assert tome["notes"] == "blood first"
    assert tome["changelog"] is None
    assert tome["created_at"].endswith("Z")
    assert tome["updated_at"].endswith("Z")
    assert tome["slots"] == [
        {
            "scryfall_id": "bolt-1",
            "name": "Lightning Bolt",
            "set_code": "lea",
            "collector_number": "1",
            "finish": "nonfoil",
            "board": "main",
            "quantity": 4,
        },
        {
            "scryfall_id": "helix-1",
            "name": "Lightning Helix",
            "set_code": "tst",
            "collector_number": "218",
            "finish": "foil",
            "board": "sideboard",
            "quantity": 1,
        },
    ]
    json.dumps(doc)  # the document must serialize as-is


def test_json_export_tome_with_no_slots_has_empty_slots_list(seeded: Path) -> None:
    with closing(db.connect()) as conn:
        empty_id = _insert_tome(conn, "Unbound Tome")
        conn.commit()
        doc = archive.export_json(conn, now=_STAMP)

    tomes = {tome["id"]: tome for tome in doc["tomes"]}
    assert tomes[empty_id]["name"] == "Unbound Tome"
    assert tomes[empty_id]["slots"] == []
    assert len(tomes[1]["slots"]) == 2  # the seeded Tome keeps its own slots


def test_json_empty_collection(catalog: Path) -> None:
    with closing(db.connect()) as conn:
        doc = archive.export_json(conn, now=_STAMP)

    assert doc == {
        "format": "markov-scriptorium-export",
        "format_version": 1,
        "exported_at": "2026-10-15T14:22:33Z",
        "schema_version": 6,
        "inventory": [],
        "tomes": [],
    }
