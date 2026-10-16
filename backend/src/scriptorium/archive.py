"""Backups and exports of the catalog (VEG-281, ADR 0023).

A backup is a timestamped copy of the SQLite file, written to a ``backups``
directory beside the catalog. The copy goes through SQLite's online backup API,
so it is consistent even while the app is serving reads. Backups come from two
places, and each keeps its own pool of recent copies:

- ``manual`` copies are taken on request. The newest ``SCRIPTORIUM_BACKUP_KEEP``
  (default 3) are kept.
- ``premigration`` copies are taken at startup before pending migrations run on
  a catalog that holds user data. The newest two are kept, so a run of manual
  backups never pushes out the copy taken before a schema change.

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
import os
import re
import sqlite3
from contextlib import closing
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal, cast

from scriptorium.db import connect, db_path

BACKUP_KEEP_ENV = "SCRIPTORIUM_BACKUP_KEEP"
DEFAULT_KEEP = 3
PREMIGRATION_KEEP = 2
# Pages copied per backup step. At SQLite's default 4 KB page size this is 4 MB.
# The source's shared lock is released between steps, so a long copy never
# blocks writers for its whole duration.
BACKUP_PAGES = 1024

Reason = Literal["manual", "premigration"]

_REASONS: tuple[Reason, ...] = ("manual", "premigration")
_FILENAME = re.compile(r"^scriptorium-(\d{8}T\d{6}Z)-v(\d+)-(manual|premigration)\.db$")
_STAMP_FORMAT = "%Y%m%dT%H%M%SZ"
_ISO_FORMAT = "%Y-%m-%dT%H:%M:%SZ"
# How long the lock probe waits for a writer before reporting the catalog busy.
_PROBE_TIMEOUT = 1.0

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
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def manual_keep() -> int:
    """How many manual backups to keep. Reads SCRIPTORIUM_BACKUP_KEEP, default 3.

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


def _verify(path: Path) -> str:
    """Run ``PRAGMA quick_check`` on a backup and return its first result row."""
    with closing(sqlite3.connect(path)) as conn:
        return str(conn.execute("PRAGMA quick_check").fetchone()[0])


def take_backup(reason: Reason, *, now: datetime | None = None) -> Backup:
    """Copy the catalog to a new timestamped file, verify it, then prune old copies.

    Raises BackupBusyError when a writer holds the catalog, and BackupError when
    the copy fails, the file fails ``quick_check``, or a backup with the same
    filename already exists. A failed backup leaves no file behind.
    """
    _probe_write_lock()

    moment = (now or datetime.now(UTC)).astimezone(UTC)
    with closing(connect()) as src:
        version = int(src.execute("PRAGMA user_version").fetchone()[0])
        filename = f"scriptorium-{moment.strftime(_STAMP_FORMAT)}-v{version}-{reason}.db"
        directory = backups_dir()
        final = directory / filename
        tmp = directory / f".{filename}.tmp"
        if final.exists() or tmp.exists():
            raise BackupCollisionError(f"a backup named {filename} already exists")

        try:
            try:
                with closing(sqlite3.connect(tmp)) as dest:
                    src.backup(dest, pages=BACKUP_PAGES)
            except sqlite3.Error as exc:
                raise BackupError(f"backup copy failed: {exc}") from exc
            result = _verify(tmp)
            if result != "ok":
                raise BackupError(f"backup failed verification: {result}")
            os.replace(tmp, final)
        finally:
            tmp.unlink(missing_ok=True)

    prune_backups()
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
    found: list[Backup] = []
    for path in backups_dir().iterdir():
        match = _FILENAME.match(path.name)
        if not match:
            continue
        try:
            size = path.stat().st_size
        except FileNotFoundError:
            continue  # pruned between the listing and the stat
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


def prune_backups() -> list[Path]:
    """Delete backups beyond each pool's keep count, oldest first; return them."""
    backups = list_backups()
    removed: list[Path] = []
    for reason in _REASONS:
        keep = manual_keep() if reason == "manual" else PREMIGRATION_KEEP
        pool = [backup for backup in backups if backup.reason == reason]
        for backup in reversed(pool[keep:]):
            path = Path(backup.path)
            path.unlink(missing_ok=True)
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
    version = int(conn.execute("PRAGMA user_version").fetchone()[0])

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

    return {
        "format": EXPORT_FORMAT,
        "format_version": EXPORT_FORMAT_VERSION,
        "exported_at": moment.strftime(_ISO_FORMAT),
        "schema_version": version,
        "inventory": inventory,
        "tomes": tomes,
    }
