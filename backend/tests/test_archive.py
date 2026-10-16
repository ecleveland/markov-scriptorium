"""Tests for catalog backups and exports (VEG-281, ADR 0023).

Each test points the catalog at a tmp file, migrates it, and seeds three cards,
one lot and one Tome with two slots through raw SQL. Llanowar Elves is neither
owned nor slotted, so a backup drops it. Backups land in a ``backups``
directory beside that tmp file.
"""

from __future__ import annotations

import csv
import gzip
import io
import json
import logging
import os
import sqlite3
import tempfile
import time
from collections.abc import Iterator
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path
from typing import get_args

import pytest

from scriptorium import archive, db, decks, inventory
from scriptorium.archive import BackupBusyError, BackupError, Reason
from scriptorium.migrations import _MIGRATIONS_DIR, _discover, apply_migrations
from scriptorium.onboarding.csv_import import parse_csv
from scriptorium.scryfall.importer import import_bulk_file
from scriptorium.scryfall.refresh import is_stale, read_status

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


def _insert_face(conn: sqlite3.Connection, scryfall_id: str, face_index: int, name: str) -> None:
    conn.execute(
        "INSERT INTO card_faces (scryfall_id, face_index, name) VALUES (?, ?, ?)",
        (scryfall_id, face_index, name),
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
    _insert_card(conn, "elf-1", "Llanowar Elves", collector_number="210")
    _insert_face(conn, "bolt-1", 0, "Lightning Bolt")
    _insert_face(conn, "elf-1", 0, "Llanowar Elves")
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
    """The tmp catalog with three cards, one lot and one Tome with two slots."""
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


def test_unwritable_backups_dir_raises_backup_error(
    seeded: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def read_only(*args: object, **kwargs: object) -> tuple[int, str]:
        raise PermissionError("read-only")

    monkeypatch.setattr("scriptorium.archive.tempfile.mkstemp", read_only)

    with pytest.raises(BackupError, match="read-only") as caught:
        archive.take_backup("manual", now=_STAMP)

    assert not isinstance(caught.value, OSError)
    assert list((seeded / "backups").iterdir()) == []


def test_prune_never_deletes_the_copy_just_sealed(seeded: Path) -> None:
    backups = archive.backups_dir()
    future = [f"scriptorium-203001{day:02d}T000000Z-v6-manual.db" for day in range(1, 11)]
    for name in future:
        (backups / name).write_bytes(b"x")

    # A clock behind the existing stamps makes the new copy the oldest by name.
    backup = archive.take_backup("manual", now=datetime(2026, 1, 1, tzinfo=UTC))

    assert Path(backup.path).is_file()
    assert backup.size_bytes > 0
    # The ten newest by name stay, and the protected copy is the one extra.
    assert sorted(p.name for p in backups.iterdir()) == sorted([*future, backup.filename])


def test_take_backup_prunes_the_manual_pool_to_keep(seeded: Path) -> None:
    backups = archive.backups_dir()
    older = [f"scriptorium-202601{day:02d}T000000Z-v6-manual.db" for day in range(1, 11)]
    for name in older:
        (backups / name).write_bytes(b"x")

    backup = archive.take_backup("manual", now=_STAMP)

    # The new copy counts toward the keep of ten, so the oldest goes.
    assert sorted(p.name for p in backups.iterdir()) == sorted([*older[1:], backup.filename])


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

    started = time.monotonic()
    with pytest.raises(BackupBusyError):
        archive.take_backup("manual", now=_STAMP)

    assert time.monotonic() - started < 8
    assert list((seeded / "backups").iterdir()) == []


def test_writer_that_starts_mid_copy_stops_the_backup_near_the_busy_limit(
    seeded: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Shrink the limit to one second to keep the test fast. The source
    # connection's own busy timeout must not add to it.
    monkeypatch.setattr(archive, "_BUSY_LIMIT_SECONDS", 1.0)
    real_mkstemp = tempfile.mkstemp
    with closing(sqlite3.connect(db.db_path())) as writer:

        def lock_then_mkstemp(*args: object, **kwargs: object) -> tuple[int, str]:
            # Runs after the probe and the version read, just before the copy.
            writer.execute("BEGIN EXCLUSIVE")
            return real_mkstemp(*args, **kwargs)  # type: ignore[call-overload,no-any-return]

        monkeypatch.setattr("scriptorium.archive.tempfile.mkstemp", lock_then_mkstemp)

        started = time.monotonic()
        try:
            with pytest.raises(BackupBusyError):
                archive.take_backup("manual", now=_STAMP)
        finally:
            writer.rollback()
        elapsed = time.monotonic() - started

    assert elapsed < 3
    assert list((seeded / "backups").iterdir()) == []


def _age(path: Path, seconds: float) -> None:
    """Set a file's mtime to ``seconds`` ago."""
    then = time.time() - seconds
    os.utime(path, (then, then))


def test_has_fresh_premigration_backup_matches_reason_version_and_age(catalog: Path) -> None:
    backups = archive.backups_dir()
    (backups / "scriptorium-20260101T000000Z-v5-manual.db").write_bytes(b"x")
    (backups / "scriptorium-20260101T000000Z-v4-premigration.db").write_bytes(b"x")
    assert archive.has_fresh_premigration_backup(5) is False

    copy = backups / "scriptorium-20260102T000000Z-v5-premigration.db"
    copy.write_bytes(b"x")
    # Ten minutes old, with the catalog touched since, so only the hour window
    # can count the copy as fresh.
    _age(copy, 600)
    os.utime(db.db_path(), None)
    assert archive.has_fresh_premigration_backup(5) is True  # written within the hour

    _age(copy, 2 * 86400)
    assert archive.has_fresh_premigration_backup(5) is False  # catalog changed since

    _age(db.db_path(), 3 * 86400)
    assert archive.has_fresh_premigration_backup(5) is True  # catalog unchanged since


def test_has_recent_startup_backup_uses_mtime_within_a_day(catalog: Path) -> None:
    backups = archive.backups_dir()
    assert archive.has_recent_startup_backup() is False

    manual = backups / "scriptorium-20260101T000000Z-v6-manual.db"
    manual.write_bytes(b"x")
    _age(manual, 2 * 3600)
    assert archive.has_recent_startup_backup() is False  # only startup copies count

    # The stamp in the name is old. The file's mtime decides.
    startup = backups / "scriptorium-20200101T000000Z-v6-startup.db"
    startup.write_bytes(b"x")
    _age(startup, 2 * 3600)
    assert archive.has_recent_startup_backup() is True

    _age(startup, 25 * 3600)
    assert archive.has_recent_startup_backup() is False


def test_prune_failure_does_not_fail_the_backup(
    seeded: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    backups = archive.backups_dir()
    older = [f"scriptorium-202601{day:02d}T000000Z-v6-manual.db" for day in range(1, 11)]
    for name in older:
        (backups / name).write_bytes(b"x")
    real_unlink = Path.unlink

    def stuck_unlink(self: Path, missing_ok: bool = False) -> None:
        if self.name == older[0]:
            raise PermissionError("read-only")
        real_unlink(self, missing_ok=missing_ok)

    monkeypatch.setattr(Path, "unlink", stuck_unlink)

    with caplog.at_level(logging.WARNING, logger="scriptorium"):
        backup = archive.take_backup("manual", now=_STAMP)

    assert Path(backup.path).is_file()
    assert (backups / older[0]).exists()
    assert "could not remove old backup" in caplog.text


def test_unreadable_backups_folder_after_sealing_does_not_fail_the_backup(
    seeded: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def unreadable(self: Path) -> Iterator[Path]:
        raise PermissionError("no listing")

    monkeypatch.setattr(Path, "iterdir", unreadable)

    backup = archive.take_backup("manual", now=_STAMP)

    assert Path(backup.path).is_file()


def test_prune_sweeps_temp_files_older_than_an_hour(catalog: Path) -> None:
    backups = archive.backups_dir()
    stale = backups / ".scriptorium-x.db.abc123.tmp"
    stale_journal = backups / ".scriptorium-x.db.abc123.tmp-journal"
    fresh = backups / ".scriptorium-y.db.def456.tmp"
    unrelated = backups / ".other.tmp"
    for path in (stale, stale_journal, fresh, unrelated):
        path.write_bytes(b"x")
    for path in (stale, stale_journal, unrelated):
        _age(path, 2 * 3600)

    archive.prune_backups()

    assert not stale.exists()
    assert not stale_journal.exists()
    assert fresh.exists()  # an in-flight copy is younger than an hour
    assert unrelated.exists()


def test_list_backups_maps_unreadable_folder_to_backup_error(
    catalog: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def unreadable(self: Path) -> Iterator[Path]:
        raise PermissionError("no listing")

    monkeypatch.setattr(Path, "iterdir", unreadable)
    with pytest.raises(BackupError, match="could not read the backups folder: no listing"):
        archive.list_backups()
    monkeypatch.undo()

    def unmakeable(self: Path, *args: object, **kwargs: object) -> None:
        raise PermissionError("read-only")

    monkeypatch.setattr(Path, "mkdir", unmakeable)
    with pytest.raises(BackupError, match="backups folder: read-only"):
        archive.backups_dir()


def test_prune_keeps_three_pools_with_new_defaults(catalog: Path) -> None:
    backups = archive.backups_dir()
    manual = [f"scriptorium-202610{day:02d}T120000Z-v6-manual.db" for day in range(1, 13)]
    premigration = [f"scriptorium-2026090{day}T120000Z-v5-premigration.db" for day in range(1, 6)]
    startup = [f"scriptorium-2026080{day}T120000Z-v6-startup.db" for day in range(1, 10)]
    for name in [*manual, *premigration, *startup, "notes.txt"]:
        (backups / name).write_bytes(b"x")

    removed = archive.prune_backups()

    remaining = sorted(p.name for p in backups.iterdir())
    assert remaining == sorted([*manual[-10:], *premigration[-3:], *startup[-7:], "notes.txt"])
    assert sorted(p.name for p in removed) == sorted([*manual[:2], *premigration[:2], *startup[:2]])


def test_reasons_regex_and_pools_derive_from_the_literal(catalog: Path) -> None:
    backups = archive.backups_dir()
    reasons: tuple[Reason, ...] = get_args(Reason)
    assert set(reasons) == {"manual", "premigration", "startup"}
    for reason in reasons:
        names = [f"scriptorium-202601{day:02d}T000000Z-v6-{reason}.db" for day in range(1, 13)]
        assert all(archive._FILENAME.match(name) for name in names), reason
        for name in names:
            (backups / name).write_bytes(b"x")

    listed = archive.list_backups()
    assert {backup.reason for backup in listed} == set(reasons)

    archive.prune_backups()

    for reason in reasons:
        kept = [p for p in backups.iterdir() if p.name.endswith(f"-{reason}.db")]
        assert len(kept) == archive._keep_for(reason), reason


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
    assert archive.manual_keep() == archive.DEFAULT_KEEP == 10

    monkeypatch.setenv(archive.BACKUP_KEEP_ENV, "7")
    assert archive.manual_keep() == 7

    for garbage in ["", "zero", "0", "-2", "2.5"]:
        monkeypatch.setenv(archive.BACKUP_KEEP_ENV, garbage)
        assert archive.manual_keep() == 10, garbage

    # The env var governs only the manual pool.
    monkeypatch.setenv(archive.BACKUP_KEEP_ENV, "2")
    assert archive._keep_for("premigration") == archive.PREMIGRATION_KEEP == 3
    assert archive._keep_for("startup") == archive.STARTUP_KEEP == 7


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


# --- shrunk copies ---------------------------------------------------------


def _count(conn: sqlite3.Connection, table: str) -> int:
    return int(conn.execute(f"SELECT count(*) FROM {table}").fetchone()[0])


def _ids(conn: sqlite3.Connection, table: str) -> list[str]:
    rows = conn.execute(f"SELECT scryfall_id FROM {table} ORDER BY scryfall_id")
    return [row[0] for row in rows]


def test_shrunk_copy_keeps_only_referenced_cards_and_faces(seeded: Path) -> None:
    backup = archive.take_backup("manual")

    with closing(sqlite3.connect(backup.path)) as copy:
        assert _ids(copy, "cards") == ["bolt-1", "helix-1"]
        assert _ids(copy, "card_faces") == ["bolt-1"]
        assert _count(copy, "inventory") == 1
        assert _count(copy, "decks") == 1
        assert _count(copy, "deck_cards") == 2
    with closing(sqlite3.connect(db.db_path())) as source:
        assert _count(source, "cards") == 3  # the live catalog is untouched


def test_shrunk_copy_passes_quick_check_and_foreign_key_check(seeded: Path) -> None:
    backup = archive.take_backup("manual")

    with closing(sqlite3.connect(backup.path)) as copy:
        assert _count(copy, "cards") == 2  # shrunk, not a full copy
        assert copy.execute("PRAGMA quick_check").fetchone()[0] == "ok"
        assert copy.execute("PRAGMA foreign_key_check").fetchall() == []


def test_shrunk_copy_fts_matches_only_kept_cards(seeded: Path) -> None:
    with closing(db.connect()) as conn:
        conn.execute("INSERT INTO cards_fts(cards_fts) VALUES('rebuild')")
        conn.commit()

    backup = archive.take_backup("manual")

    with closing(sqlite3.connect(backup.path)) as copy:
        match = "SELECT name FROM cards_fts WHERE cards_fts MATCH ? ORDER BY name"
        assert copy.execute(match, ("Llanowar",)).fetchall() == []
        assert [row[0] for row in copy.execute(match, ("Lightning",))] == [
            "Lightning Bolt",
            "Lightning Helix",
        ]


def test_shrunk_copy_has_empty_scryfall_refresh(seeded: Path) -> None:
    with closing(db.connect()) as conn:
        conn.execute(
            "INSERT INTO scryfall_refresh (id, imported_at, card_count) "
            "VALUES (1, '2026-10-14T00:00:00Z', 3)"
        )
        conn.commit()

    backup = archive.take_backup("manual")

    with closing(sqlite3.connect(backup.path)) as copy:
        assert _count(copy, "scryfall_refresh") == 0
    with closing(sqlite3.connect(db.db_path())) as source:
        assert _count(source, "scryfall_refresh") == 1


def test_shrunk_copy_is_smaller_than_the_catalog(seeded: Path) -> None:
    filler_text = "Whenever a Vampire enters the battlefield, " * 40
    with closing(db.connect()) as conn:
        for number in range(2000):
            _insert_card(
                conn,
                f"filler-{number}",
                f"Filler {number}",
                collector_number=str(number),
                oracle_text=filler_text,
            )
        conn.commit()

    backup = archive.take_backup("manual")

    catalog_size = db.db_path().stat().st_size
    assert backup.size_bytes < catalog_size / 4


def test_shrunk_copy_serves_inventory_and_tomes(seeded: Path) -> None:
    backup = archive.take_backup("manual")

    with closing(sqlite3.connect(backup.path)) as copy:
        copy.row_factory = sqlite3.Row
        copy.execute("PRAGMA foreign_keys = ON")
        assert _count(copy, "cards") == 2  # shrunk, not a full copy
        lots, total = inventory.list_lots(copy, limit=50, offset=0)
        tome = decks.get_deck(copy, 1)

    assert total == 1
    assert [(lot["scryfall_id"], lot["card"]["name"]) for lot in lots] == [
        ("bolt-1", "Lightning Bolt")
    ]
    assert tome is not None
    assert tome["name"] == "Edgar's Court"
    assert sorted((slot["scryfall_id"], slot["card"]["name"]) for slot in tome["cards"]) == [
        ("bolt-1", "Lightning Bolt"),
        ("helix-1", "Lightning Helix"),
    ]


def test_shrink_on_schema_without_deck_cards(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    db_file = tmp_path / "catalog.db"
    monkeypatch.setenv("SCRIPTORIUM_DB_PATH", str(db_file))
    older = tmp_path / "migrations_0005"
    older.mkdir()
    for version, migration in _discover(_MIGRATIONS_DIR):
        if version <= 5:
            (older / migration.name).write_text(migration.read_text())
    with closing(sqlite3.connect(db_file)) as conn:
        assert apply_migrations(conn, older) == 5
        _insert_card(conn, "bolt-1", "Lightning Bolt")
        _insert_card(conn, "elf-1", "Llanowar Elves")
        _insert_lot(conn, "bolt-1", quantity=3)
        conn.commit()

    backup = archive.take_backup("manual")

    with closing(sqlite3.connect(backup.path)) as copy:
        assert _user_version(copy) == backup.schema_version == 5
        assert _ids(copy, "cards") == ["bolt-1"]
        assert copy.execute("SELECT scryfall_id, quantity FROM inventory").fetchall() == [
            ("bolt-1", 3)
        ]
        assert copy.execute("PRAGMA quick_check").fetchone()[0] == "ok"
        assert copy.execute("PRAGMA foreign_key_check").fetchall() == []


def test_shrink_failure_leaves_no_file(seeded: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(conn: sqlite3.Connection) -> None:
        raise sqlite3.OperationalError("boom")

    monkeypatch.setattr("scriptorium.archive.rebuild_name_index", boom)

    with pytest.raises(BackupError, match="shrunk") as caught:
        archive.take_backup("manual", now=_STAMP)

    assert "boom" in str(caught.value)
    assert list((seeded / "backups").iterdir()) == []


def test_foreign_key_check_failure_fails_the_backup(
    seeded: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def orphan_a_face(path: Path) -> None:
        with closing(sqlite3.connect(path)) as conn:
            conn.execute("PRAGMA foreign_keys = OFF")
            conn.execute(
                "INSERT INTO card_faces (scryfall_id, face_index, name) "
                "VALUES ('ghost-1', 0, 'Ghost')"
            )
            conn.commit()

    monkeypatch.setattr(archive, "_shrink", orphan_a_face)

    with pytest.raises(BackupError, match="foreign_key_check"):
        archive.take_backup("manual", now=_STAMP)

    assert list((seeded / "backups").iterdir()) == []


def test_restored_shrunk_copy_refreshes_and_keeps_owned_cards(seeded: Path, tmp_path: Path) -> None:
    with closing(db.connect()) as conn:
        conn.execute(
            "INSERT INTO scryfall_refresh (id, imported_at, card_count) "
            "VALUES (1, '2026-10-14T00:00:00Z', 3)"
        )
        conn.commit()
    backup = archive.take_backup("manual")
    bulk = tmp_path / "bulk.json.gz"
    edgar = {
        "id": "edgar-1",
        "name": "Edgar Markov",
        "set": "c17",
        "set_name": "Commander 2017",
        "collector_number": "36",
        "rarity": "mythic",
        "lang": "en",
        "layout": "normal",
    }
    bulk.write_bytes(gzip.compress(json.dumps([edgar]).encode()))

    with closing(sqlite3.connect(backup.path)) as copy:
        copy.row_factory = sqlite3.Row
        copy.execute("PRAGMA foreign_keys = ON")
        # No refresh row, so the restored copy reads as stale and refreshes on
        # its first start.
        status = read_status(copy)
        assert status is None
        assert is_stale(status, now=datetime.now(UTC)) is True

        import_bulk_file(copy, bulk)

        assert _ids(copy, "cards") == ["bolt-1", "edgar-1", "helix-1"]
        assert _count(copy, "inventory") == 1
        assert _count(copy, "deck_cards") == 2


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
