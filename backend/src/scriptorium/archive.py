"""Backups and exports of the catalog (VEG-281, VEG-612, ADRs 0023 and 0024).

A backup is a timestamped copy of the SQLite file, written to a ``backups``
directory beside the catalog. The copy goes through SQLite's online backup API,
so it is consistent even while the app is serving reads. Backups come from
three places, and each keeps its own pool of recent copies:

- ``manual`` copies are taken on request. The newest ``SCRIPTORIUM_BACKUP_KEEP``
  (default 10) are kept.
- ``premigration`` copies are taken at startup before pending migrations run on
  a catalog that holds user data. The newest three are kept, so a run of manual
  backups never pushes out the copy taken before a schema change.
- ``daily`` copies are taken in the background, at most once a day, when the
  catalog holds user data. The app checks after startup and then every hour,
  so a server left running still seals one a day. The newest seven are kept.

Each copy is shrunk before it is verified. Scryfall printings that no lot or
Tome slot references are deleted from the copy, along with their faces, the
name index is rebuilt over the cards that remain, and the refresh record is
cleared. VACUUM then hands the freed pages back, so a copy holds the user's
data and only the card rows it needs. A restored copy has no refresh record,
so the app reads its catalog as stale and the next refresh fills the
unreferenced printings back in. The live catalog is never shrunk.

The filename carries everything a listing needs:
``scriptorium-<YYYYMMDDTHHMMSSZ>-v<schema version>-<reason>.db``. Files that do
not match that pattern are never listed or deleted.

Exports turn the user's own data (inventory lots and Tomes) into a CSV that the
Manabox importer reads back, and into a JSON document with every field. The
Scryfall card catalog is not exported because a refresh rebuilds it.
"""

from __future__ import annotations

import csv
import io
import json
import logging
import os
import re
import sqlite3
import tempfile
import time
from collections import Counter
from collections.abc import Iterator
from contextlib import closing
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal, cast, get_args

from scriptorium.catalog import rebuild_name_index
from scriptorium.db import connect, db_path

logger = logging.getLogger("scriptorium")

BACKUP_KEEP_ENV = "SCRIPTORIUM_BACKUP_KEEP"
DEFAULT_KEEP = 10
PREMIGRATION_KEEP = 3
DAILY_KEEP = 7
# Pages copied per backup step. At SQLite's default 4 KB page size this is 4 MB.
# The source's shared lock is released between steps, so a long copy never
# blocks writers for its whole duration.
BACKUP_PAGES = 1024
# CPython sleeps this long between retries when a backup step finds the source
# locked, and retries forever. _BusyLimit gives up after about five seconds.
# The source connection's busy timeout is this same short wait, so it adds
# one sleep to the first locked step, not the default five seconds.
_BACKUP_SLEEP = 0.25
_BUSY_LIMIT_SECONDS = 5.0
_BUSY_STATUSES = frozenset({sqlite3.SQLITE_BUSY, sqlite3.SQLITE_LOCKED})

Reason = Literal["manual", "premigration", "daily"]

_REASONS: tuple[Reason, ...] = get_args(Reason)
_FILENAME = re.compile(rf"^scriptorium-(\d{{8}}T\d{{6}}Z)-v(\d+)-({'|'.join(_REASONS)})\.db$")
_STAMP_FORMAT = "%Y%m%dT%H%M%SZ"
_ISO_FORMAT = "%Y-%m-%dT%H:%M:%SZ"
# How long the lock probe waits for a writer before reporting the catalog busy.
_PROBE_TIMEOUT = 1.0
# A pre-migration copy this young still counts as fresh, which covers a
# restart loop on a failing migration whose rollback touches the catalog file.
_FRESH_PREMIGRATION_SECONDS = 3600
# A daily copy is due when no daily copy is younger than this.
_DAILY_INTERVAL_SECONDS = 86400
# Tables the shrink reads or trims. Older schemas may lack some of them.
_SHRINK_TABLES = ("inventory", "deck_cards", "cards", "card_faces", "cards_fts", "scryfall_refresh")
# Tables whose rows keep a printing in a shrunk copy.
_REFERENCING_TABLES = ("inventory", "deck_cards")
# Temp files older than this are leftovers from a crashed copy. A copy in
# flight is far younger.
_STALE_TEMP_SECONDS = 3600
_TEMP_FILE = re.compile(r"^\.scriptorium-.*\.tmp(-journal)?$")

_CSV_HEADER = [
    "Name",
    "Set code",
    "Set name",
    "Collector number",
    "Foil",
    "Rarity",
    "Quantity",
    "Scryfall ID",
    "Condition",
    "Language",
    "Location",
    "Notes",
    "Tags",
    "Acquired at",
    "Price paid",
]
# The catalog's finish and condition enums, spelled the way Manabox spells them,
# so the CSV export parses back through the onboarding importer unchanged.
_CSV_FINISH = {"nonfoil": "normal", "foil": "foil", "etched": "etched"}
_CSV_CONDITION = {
    "NM": "near_mint",
    "LP": "lightly_played",
    "MP": "moderately_played",
    "HP": "heavily_played",
    "DMG": "damaged",
}

EXPORT_FORMAT = "markov-scriptorium-export"
EXPORT_FORMAT_VERSION = 1


class BackupError(RuntimeError):
    """Raised when a backup cannot be written or fails verification."""


class BackupBusyError(BackupError):
    """Raised when another connection holds a write lock on the catalog."""


class BackupCollisionError(BackupError):
    """Raised when a backup with the same filename already exists."""


@dataclass(frozen=True)
class Backup:
    """One backup file on disk, described by its filename."""

    filename: str
    path: str
    reason: Reason
    created_at: str  # ISO 8601 UTC, e.g. 2026-10-15T14:22:33Z
    schema_version: int
    size_bytes: int


def backups_dir() -> Path:
    """The directory holding backups, beside the catalog file. Created if missing."""
    directory = db_path().parent / "backups"
    try:
        directory.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise BackupError(f"could not open the backups folder: {exc}") from exc
    return directory


def manual_keep() -> int:
    """How many manual backups to keep. Reads SCRIPTORIUM_BACKUP_KEEP, default 10.

    A value that is not a whole number, or is below 1, falls back to the
    default. Keeping zero copies would delete each backup as soon as it was
    written.
    """
    raw = os.environ.get(BACKUP_KEEP_ENV, "")
    try:
        keep = int(raw)
    except ValueError:
        return DEFAULT_KEEP
    return keep if keep >= 1 else DEFAULT_KEEP


def _keep_for(reason: Reason) -> int:
    """How many backups of ``reason`` to keep. Only manual reads the env var."""
    if reason == "manual":
        return manual_keep()
    if reason == "premigration":
        return PREMIGRATION_KEEP
    return DAILY_KEEP


def has_user_data(conn: sqlite3.Connection) -> bool:
    """True if the catalog holds at least one inventory lot or Tome.

    A fresh or partly migrated database may lack those tables, which counts as
    no user data. Scryfall cards are not user data because a refresh restores
    them.
    """
    for table in ("inventory", "decks"):
        exists = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (table,)
        ).fetchone()
        if exists and conn.execute(f"SELECT EXISTS (SELECT 1 FROM {table})").fetchone()[0]:
            return True
    return False


def _probe_write_lock() -> None:
    """Raise BackupBusyError if another connection holds a write lock.

    CPython's backup loop retries a busy source forever, so a copy started
    while the Scryfall importer holds its long transaction would hang. Taking
    and releasing RESERVED first turns that into a quick, clear error. The
    probe closes before the copy starts, so it never blocks the importer.
    """
    try:
        with closing(sqlite3.connect(db_path(), timeout=_PROBE_TIMEOUT)) as probe:
            try:
                probe.execute("BEGIN IMMEDIATE")
            except sqlite3.OperationalError as exc:
                if "locked" in str(exc):
                    raise BackupBusyError(
                        "the catalog is busy with a write; try the backup again shortly"
                    ) from exc
                raise
            probe.rollback()
    except BackupBusyError:
        raise
    except sqlite3.Error as exc:
        raise BackupError(f"could not open the catalog for backup: {exc}") from exc


def has_fresh_premigration_backup(version: int) -> bool:
    """True if a pre-migration copy of schema ``version`` still covers the catalog.

    A copy covers it when the copy is no older than the catalog file, so
    nothing has changed since, or when it was written within the last hour.
    The hour covers a migration that fails on every start, so a restart loop
    does not take a copy each time and prune the one from the first attempt.
    An older copy taken before new lots were inscribed does not count.
    """
    try:
        catalog_mtime = db_path().stat().st_mtime
    except OSError as exc:
        raise BackupError(f"could not read the catalog file: {exc}") from exc
    now = time.time()
    return any(
        mtime >= catalog_mtime or now - mtime < _FRESH_PREMIGRATION_SECONDS
        for _, mtime in _backup_mtimes("premigration", version)
    )


def has_recent_daily_backup() -> bool:
    """True if a daily copy was written within the last day.

    The file's mtime decides, not the stamp in its name, so a clock that
    jumped since the copy was named cannot skip or repeat the daily copy.
    """
    now = time.time()
    return any(now - mtime < _DAILY_INTERVAL_SECONDS for _, mtime in _backup_mtimes("daily"))


def _backup_mtimes(reason: Reason, version: int | None = None) -> Iterator[tuple[Backup, float]]:
    """Yield each backup of ``reason``, and of ``version`` if given, with its mtime.

    A file pruned between the listing and the stat is skipped. Any other
    stat failure raises BackupError.
    """
    for backup in list_backups():
        if backup.reason != reason:
            continue
        if version is not None and backup.schema_version != version:
            continue
        try:
            mtime = Path(backup.path).stat().st_mtime
        except FileNotFoundError:
            continue  # pruned since the listing
        except OSError as exc:
            raise BackupError(f"could not read the backups folder: {exc}") from exc
        yield backup, mtime


def seal_daily_if_due() -> Backup | None:
    """Take the daily copy if the catalog holds user data and none is under a day old.

    Returns the new copy, or None when no copy was due or the copy failed. A
    failure is logged rather than raised, because this runs in the background
    while the app serves requests. The next hourly check tries again.
    """
    try:
        with closing(connect()) as conn:
            if not has_user_data(conn):
                return None
        if has_recent_daily_backup():
            return None
        backup = take_backup("daily")
    except (BackupError, sqlite3.Error):
        logger.exception("daily backup failed; the app keeps running")
        return None
    logger.info("sealed the daily backup at %s", backup.path)
    return backup


class _BusyLimit:
    """Backup progress callback that gives up when the source stays locked.

    The probe catches a writer that is already running. This catches one that
    starts mid-copy, such as a Scryfall refresh holding its import transaction.
    Each locked step costs one ``_BACKUP_SLEEP``, so after about five seconds
    of consecutive locked steps it raises BackupBusyError and the copy stops.
    Any step that makes progress resets the count.
    """

    def __init__(self) -> None:
        self.max_retries = round(_BUSY_LIMIT_SECONDS / _BACKUP_SLEEP)
        self.consecutive = 0

    def __call__(self, status: int, remaining: int, total: int) -> None:
        if status not in _BUSY_STATUSES:
            self.consecutive = 0
            return
        self.consecutive += 1
        if self.consecutive > self.max_retries:
            raise BackupBusyError(
                "the catalog stayed locked by a writer during the backup; try again shortly"
            )


def _existing_tables(conn: sqlite3.Connection, names: tuple[str, ...]) -> set[str]:
    """The subset of ``names`` that exist as tables, read from one schema query."""
    placeholders = ", ".join("?" for _ in names)
    rows = conn.execute(
        f"SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ({placeholders})",
        names,
    )
    return {row[0] for row in rows}


def _shrink(path: Path) -> None:
    """Trim a fresh copy to the printings its lots and Tome slots reference.

    Deletes every other card and its faces, rebuilds the name index over what
    is left, clears the refresh record, then runs VACUUM so the file gives the
    freed pages back. Faces are deleted explicitly rather than through the
    cascade. A copy of an older schema may lack ``deck_cards`` or
    ``inventory``, and a copy with neither keeps no cards at all.
    """
    try:
        with closing(sqlite3.connect(path)) as conn:
            conn.execute("PRAGMA foreign_keys = ON")
            tables = _existing_tables(conn, _SHRINK_TABLES)
            referenced = " UNION ".join(
                f"SELECT scryfall_id FROM {table}"
                for table in _REFERENCING_TABLES
                if table in tables
            )
            unreferenced = f" WHERE scryfall_id NOT IN ({referenced})" if referenced else ""
            conn.execute("BEGIN")
            try:
                if "card_faces" in tables:
                    conn.execute(f"DELETE FROM card_faces{unreferenced}")
                if "cards" in tables:
                    conn.execute(f"DELETE FROM cards{unreferenced}")
                if "cards_fts" in tables:
                    rebuild_name_index(conn)
                if "scryfall_refresh" in tables:
                    conn.execute("DELETE FROM scryfall_refresh")
                conn.execute("COMMIT")
            except BaseException:
                if conn.in_transaction:
                    conn.execute("ROLLBACK")
                raise
            conn.execute("VACUUM")
    except sqlite3.Error as exc:
        raise BackupError(f"backup could not be shrunk: {exc}") from exc


def _open_read_only(path: Path) -> sqlite3.Connection:
    """Open ``path`` read-only, so a missing file raises instead of being created.

    ``as_uri`` percent-encodes the path, because SQLite would otherwise read a
    "#" or "?" in it as URI syntax.
    """
    return sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True)


def _count_violations(conn: sqlite3.Connection) -> Counter[tuple[str, str, int]]:
    """Count ``PRAGMA foreign_key_check`` rows by child table, parent table and key.

    The rowid is left out of the key because VACUUM may renumber rowids in a
    table without an INTEGER PRIMARY KEY, such as ``card_faces``.
    """
    return Counter(
        (str(table), str(parent), int(fkid))
        for table, _rowid, parent, fkid in conn.execute("PRAGMA foreign_key_check")
    )


def _fk_violations(path: Path) -> Counter[tuple[str, str, int]]:
    """The foreign key violations a fresh copy already holds, before the shrink."""
    with closing(_open_read_only(path)) as conn:
        return _count_violations(conn)


def _verify(path: Path, baseline: Counter[tuple[str, str, int]]) -> str:
    """Check a backup and return the first ``PRAGMA quick_check`` result row.

    Also runs ``PRAGMA foreign_key_check`` and raises BackupError if the copy
    holds a violation that ``baseline`` did not. Such a violation would mean
    the shrink dropped a card that a lot or slot still needs. Violations the
    catalog already had, such as an orphan lot written with foreign keys off,
    are carried into the copy as they are and do not fail it.
    """
    with closing(_open_read_only(path)) as conn:
        result = str(conn.execute("PRAGMA quick_check").fetchone()[0])
        introduced = _count_violations(conn) - baseline
        if introduced:
            raise BackupError(f"backup failed foreign_key_check: {sorted(introduced)}")
        return result


def take_backup(reason: Reason, *, now: datetime | None = None) -> Backup:
    """Copy the catalog to a new timestamped file, shrink and verify it, then prune.

    Raises BackupBusyError when a writer holds the catalog, and BackupError when
    the copy or the shrink fails, the file fails ``quick_check`` or
    ``foreign_key_check``, a backup with the same filename already exists, or
    the backups folder cannot be written. A failed backup leaves no file behind.
    """
    _probe_write_lock()

    moment = (now or datetime.now(UTC)).astimezone(UTC)
    try:
        backup = _seal(reason, moment)
    except OSError as exc:
        # A read-only or full backups folder. Mapping it here keeps the API's
        # 500 detail and the startup log naming the backup, not the migration.
        raise BackupError(f"could not write the backup: {exc}") from exc

    # The copy is sealed. Failing to tidy old copies must not undo that.
    try:
        prune_backups(protect=Path(backup.path))
    except BackupError as exc:
        logger.warning("could not prune old backups: %s", exc)
    return backup


def _read_source_version(src: sqlite3.Connection) -> int:
    """The source's ``user_version``, mapping a held write lock to BackupBusyError."""
    try:
        return int(src.execute("PRAGMA user_version").fetchone()[0])
    except sqlite3.OperationalError as exc:
        if "locked" in str(exc):
            raise BackupBusyError(
                "the catalog is busy with a write; try the backup again shortly"
            ) from exc
        raise BackupError(f"could not read the catalog for backup: {exc}") from exc


def _seal(reason: Reason, moment: datetime) -> Backup:
    """Copy, shrink, verify and publish one backup. File errors propagate as OSError."""
    # Not db.connect(): its five second busy timeout would stall the first
    # locked step before _BusyLimit starts counting. A backup needs neither
    # the row factory nor foreign keys.
    with closing(sqlite3.connect(db_path(), timeout=_BACKUP_SLEEP)) as src:
        version = _read_source_version(src)
        filename = f"scriptorium-{moment.strftime(_STAMP_FORMAT)}-v{version}-{reason}.db"
        directory = backups_dir()
        final = directory / filename
        if final.exists():
            raise BackupCollisionError(f"a backup named {filename} already exists")

        # A temp file unique to this attempt, so two same-second backups never
        # write into, verify, or publish each other's copy.
        fd, tmp_name = tempfile.mkstemp(dir=directory, prefix=f".{filename}.", suffix=".tmp")
        os.close(fd)
        tmp = Path(tmp_name)
        try:
            try:
                with closing(sqlite3.connect(tmp)) as dest:
                    src.backup(dest, pages=BACKUP_PAGES, progress=_BusyLimit(), sleep=_BACKUP_SLEEP)
            except sqlite3.Error as exc:
                raise BackupError(f"backup copy failed: {exc}") from exc
            try:
                baseline = _fk_violations(tmp)
            except sqlite3.Error as exc:
                raise BackupError(f"backup could not be verified: {exc}") from exc
            _shrink(tmp)
            try:
                result = _verify(tmp, baseline)
            except sqlite3.Error as exc:
                raise BackupError(f"backup could not be verified: {exc}") from exc
            if result != "ok":
                raise BackupError(f"backup failed verification: {result}")
            os.replace(tmp, final)
        finally:
            tmp.unlink(missing_ok=True)

    return Backup(
        filename=filename,
        path=str(final),
        reason=reason,
        created_at=moment.strftime(_ISO_FORMAT),
        schema_version=version,
        size_bytes=final.stat().st_size,
    )


def list_backups() -> list[Backup]:
    """Every backup in the backups directory, newest first."""
    directory = backups_dir()
    try:
        paths = list(directory.iterdir())
    except OSError as exc:
        raise BackupError(f"could not read the backups folder: {exc}") from exc
    found: list[Backup] = []
    for path in paths:
        match = _FILENAME.match(path.name)
        if not match:
            continue
        try:
            size = path.stat().st_size
        except FileNotFoundError:
            continue  # pruned between the listing and the stat
        except OSError as exc:
            raise BackupError(f"could not read the backups folder: {exc}") from exc
        stamp, version, reason = match.groups()
        found.append(
            Backup(
                filename=path.name,
                path=str(path),
                reason=cast(Reason, reason),
                created_at=datetime.strptime(stamp, _STAMP_FORMAT).strftime(_ISO_FORMAT),
                schema_version=int(version),
                size_bytes=size,
            )
        )
    # The stamp leads the variable part of the name, so lexical order is
    # chronological order.
    return sorted(found, key=lambda backup: backup.filename, reverse=True)


def prune_backups(*, protect: Path | None = None) -> list[Path]:
    """Delete backups beyond each pool's keep count, oldest first; return them.

    ``protect`` counts toward its pool's keep but is never deleted. take_backup
    passes the copy it just wrote. If the clock is behind older stamps, that
    copy sorts oldest, and the pool then holds one more than the keep count.
    A file that cannot be removed is logged and skipped. Stale temp files from
    crashed copies are swept first.
    """
    _sweep_stale_temp_files(backups_dir())
    backups = list_backups()
    removed: list[Path] = []
    for reason in _REASONS:
        keep = _keep_for(reason)
        pool = [backup for backup in backups if backup.reason == reason]
        for backup in reversed(pool[keep:]):
            path = Path(backup.path)
            if protect is not None and path == protect:
                continue
            try:
                path.unlink(missing_ok=True)
            except OSError as exc:
                logger.warning("could not remove old backup %s: %s", path, exc)
                continue
            removed.append(path)
    return removed


def _sweep_stale_temp_files(directory: Path) -> list[Path]:
    """Remove temp files and their journals left by copies that never finished."""
    try:
        paths = list(directory.iterdir())
    except OSError as exc:
        raise BackupError(f"could not read the backups folder: {exc}") from exc
    cutoff = time.time() - _STALE_TEMP_SECONDS
    removed: list[Path] = []
    for path in paths:
        if not _TEMP_FILE.match(path.name):
            continue
        try:
            if path.stat().st_mtime >= cutoff:
                continue
            path.unlink(missing_ok=True)
        except FileNotFoundError:
            continue
        except OSError as exc:
            logger.warning("could not remove old backup %s: %s", path, exc)
            continue
        removed.append(path)
    return removed


def _tags(raw: str | None) -> list[str] | None:
    """Decode the inventory ``tags`` JSON text. NULL stays None."""
    return None if raw is None else cast(list[str], json.loads(raw))


def export_csv(conn: sqlite3.Connection) -> str:
    """Every inventory lot as a Manabox-style CSV, one row per lot, in lot order."""
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\n")
    writer.writerow(_CSV_HEADER)
    rows = conn.execute(
        """
        SELECT c.name, c.set_code, c.set_name, c.collector_number, c.rarity,
               i.finish, i.quantity, i.scryfall_id, i.condition, i.language,
               i.location, i.notes, i.tags, i.acquired_at, i.price_paid
        FROM inventory i
        JOIN cards c ON c.scryfall_id = i.scryfall_id
        ORDER BY i.id
        """
    )
    for row in rows:
        writer.writerow(
            [
                row["name"],
                row["set_code"],
                row["set_name"] or "",
                row["collector_number"],
                _CSV_FINISH[row["finish"]],
                row["rarity"] or "",
                row["quantity"],
                row["scryfall_id"],
                _CSV_CONDITION[row["condition"]],
                row["language"],
                row["location"] or "",
                row["notes"] or "",
                ";".join(_tags(row["tags"]) or []),
                row["acquired_at"] or "",
                row["price_paid"] or "",
            ]
        )
    return out.getvalue()


def export_json(conn: sqlite3.Connection, *, now: datetime | None = None) -> dict[str, Any]:
    """Every inventory lot and Tome, with its slots, as one JSON-ready document."""
    moment = (now or datetime.now(UTC)).astimezone(UTC)

    # One read transaction over every query, so a write landing between them
    # cannot leave a slot pointing at a Tome or lot from another moment.
    conn.execute("BEGIN")
    try:
        version = int(conn.execute("PRAGMA user_version").fetchone()[0])
        inventory, tomes = _read_export(conn)
        conn.commit()
    finally:
        if conn.in_transaction:
            conn.rollback()

    return {
        "format": EXPORT_FORMAT,
        "format_version": EXPORT_FORMAT_VERSION,
        "exported_at": moment.strftime(_ISO_FORMAT),
        "schema_version": version,
        "inventory": inventory,
        "tomes": tomes,
    }


def _read_export(conn: sqlite3.Connection) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Read every lot and every Tome with its slots, for export_json."""
    inventory = [
        {
            "id": row["id"],
            "scryfall_id": row["scryfall_id"],
            "quantity": row["quantity"],
            "finish": row["finish"],
            "condition": row["condition"],
            "language": row["language"],
            "location": row["location"],
            "acquired_at": row["acquired_at"],
            "price_paid": row["price_paid"],
            "notes": row["notes"],
            "tags": _tags(row["tags"]),
            "card": {
                "name": row["name"],
                "set_code": row["set_code"],
                "set_name": row["set_name"],
                "collector_number": row["collector_number"],
            },
        }
        for row in conn.execute(
            """
            SELECT i.id, i.scryfall_id, i.quantity, i.finish, i.condition, i.language,
                   i.location, i.acquired_at, i.price_paid, i.notes, i.tags,
                   c.name, c.set_code, c.set_name, c.collector_number
            FROM inventory i
            JOIN cards c ON c.scryfall_id = i.scryfall_id
            ORDER BY i.id
            """
        )
    ]

    slots: dict[int, list[dict[str, Any]]] = {}
    for row in conn.execute(
        """
        SELECT dc.deck_id, dc.scryfall_id, c.name, c.set_code, c.collector_number,
               dc.finish, dc.board, dc.quantity
        FROM deck_cards dc
        JOIN cards c ON c.scryfall_id = dc.scryfall_id
        ORDER BY dc.id
        """
    ):
        slots.setdefault(row["deck_id"], []).append(
            {
                "scryfall_id": row["scryfall_id"],
                "name": row["name"],
                "set_code": row["set_code"],
                "collector_number": row["collector_number"],
                "finish": row["finish"],
                "board": row["board"],
                "quantity": row["quantity"],
            }
        )

    tomes = [
        {
            "id": row["id"],
            "name": row["name"],
            "format": row["format"],
            "status": row["status"],
            "claims_cards": bool(row["claims_cards"]),
            "notes": row["notes"],
            "changelog": row["changelog"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "slots": slots.get(row["id"], []),
        }
        for row in conn.execute(
            """
            SELECT id, name, format, status, claims_cards, notes, changelog,
                   created_at, updated_at
            FROM decks
            ORDER BY id
            """
        )
    ]
    return inventory, tomes
