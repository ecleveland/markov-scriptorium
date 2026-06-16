"""Keep the local Scryfall catalog fresh (VEG-214, ADR 0007).

Orchestrates the downloader (VEG-212) and importer (VEG-213) into one
staleness-gated refresh and records the outcome in the ``scryfall_refresh``
metadata table, so the app can both decide whether a refresh is due and report
when the catalog was last updated.

Two levels:

- :func:`refresh_catalog` always contacts Scryfall: it fetches the cheap
  bulk-data listing and, unless the published version differs (or ``force`` is
  set), skips the ~1.5 GB download/import — the export changes about once a day.
- :func:`maybe_refresh` is the startup gate: it runs ``refresh_catalog`` only
  when the catalog is stale (never refreshed, or last checked over 24h ago), so
  a restart doesn't re-hit Scryfall on every launch.
"""

from __future__ import annotations

import logging
import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import httpx

from scriptorium.scryfall.bulk import download_bulk, fetch_bulk_entry
from scriptorium.scryfall.importer import import_bulk_file

logger = logging.getLogger("scriptorium")

# Scryfall publishes the bulk export roughly daily; re-checking more often than
# this just re-requests the same file. See ADR 0007.
REFRESH_MAX_AGE = timedelta(hours=24)


@dataclass(frozen=True)
class RefreshStatus:
    """The recorded state of the last refresh (all ``None`` before the first)."""

    last_checked_at: str | None
    source_updated_at: str | None
    imported_at: str | None
    file: str | None
    card_count: int | None
    face_count: int | None


@dataclass(frozen=True)
class RefreshResult:
    """Outcome of a refresh attempt."""

    imported: bool  # True when a new version was downloaded and imported
    status: RefreshStatus  # the metadata after the attempt


def _utcnow() -> datetime:
    return datetime.now(UTC)


def read_status(conn: sqlite3.Connection) -> RefreshStatus | None:
    """Return the recorded refresh metadata, or ``None`` if none exists yet."""
    row = conn.execute(
        "SELECT last_checked_at, source_updated_at, imported_at, file, "
        "card_count, face_count FROM scryfall_refresh WHERE id = 1"
    ).fetchone()
    if row is None:
        return None
    # Index access works for both sqlite3.Row and a plain tuple cursor.
    return RefreshStatus(
        last_checked_at=row[0],
        source_updated_at=row[1],
        imported_at=row[2],
        file=row[3],
        card_count=row[4],
        face_count=row[5],
    )


def is_stale(
    status: RefreshStatus | None,
    *,
    now: datetime,
    max_age: timedelta = REFRESH_MAX_AGE,
) -> bool:
    """True if the catalog has never been refreshed or the last check is too old."""
    if status is None or status.last_checked_at is None:
        return True
    last_checked = datetime.fromisoformat(status.last_checked_at)
    return now - last_checked >= max_age


def _record_check(conn: sqlite3.Connection, *, now: datetime) -> None:
    """Record that we checked Scryfall, preserving any imported-version fields."""
    conn.execute(
        "INSERT INTO scryfall_refresh (id, last_checked_at) VALUES (1, ?) "
        "ON CONFLICT(id) DO UPDATE SET last_checked_at = excluded.last_checked_at",
        (now.isoformat(),),
    )
    conn.commit()


def _record_import(
    conn: sqlite3.Connection,
    *,
    now: datetime,
    source_updated_at: str,
    file: str,
    card_count: int,
    face_count: int,
) -> None:
    """Record a successful import (version, counts, timestamps) as the one row."""
    conn.execute(
        "INSERT INTO scryfall_refresh "
        "(id, last_checked_at, source_updated_at, imported_at, file, card_count, face_count) "
        "VALUES (1, ?, ?, ?, ?, ?, ?) "
        "ON CONFLICT(id) DO UPDATE SET "
        "last_checked_at = excluded.last_checked_at, "
        "source_updated_at = excluded.source_updated_at, "
        "imported_at = excluded.imported_at, "
        "file = excluded.file, "
        "card_count = excluded.card_count, "
        "face_count = excluded.face_count",
        (now.isoformat(), source_updated_at, now.isoformat(), file, card_count, face_count),
    )
    conn.commit()


def _require_status(conn: sqlite3.Connection) -> RefreshStatus:
    status = read_status(conn)
    if status is None:  # pragma: no cover - a row was just written
        raise RuntimeError("scryfall_refresh row missing after write")
    return status


def refresh_catalog(
    conn: sqlite3.Connection,
    *,
    client: httpx.Client | None = None,
    force: bool = False,
    now: datetime | None = None,
) -> RefreshResult:
    """Bring the local catalog up to date from Scryfall's bulk export.

    Fetches the cheap bulk-data listing and compares its version to what we last
    imported: if unchanged (and not ``force``), records the check and returns
    without the heavy download/import. Otherwise downloads the export and
    full-replaces the catalog, then records the new version.

    Propagates :class:`~scriptorium.scryfall.bulk.ScryfallBulkError` and
    :class:`~scriptorium.scryfall.importer.BulkImportError` on failure; the
    metadata is only written after the step it describes succeeds.
    """
    moment = now or _utcnow()
    entry = fetch_bulk_entry(client=client)
    current_version = (status := read_status(conn)) and status.source_updated_at

    if not force and current_version is not None and current_version == entry.updated_at:
        logger.info("Scryfall catalog already at version %s; skipping import", entry.updated_at)
        _record_check(conn, now=moment)
        return RefreshResult(imported=False, status=_require_status(conn))

    logger.info("refreshing Scryfall catalog to version %s", entry.updated_at)
    path = download_bulk(entry.bulk_type, client=client, entry=entry)
    result = import_bulk_file(conn, path)
    _record_import(
        conn,
        now=moment,
        source_updated_at=entry.updated_at,
        file=str(path),
        card_count=result.cards,
        face_count=result.faces,
    )
    return RefreshResult(imported=True, status=_require_status(conn))


def maybe_refresh(
    conn: sqlite3.Connection,
    *,
    client: httpx.Client | None = None,
    now: datetime | None = None,
) -> RefreshResult | None:
    """Refresh only if the catalog is stale — the app's startup entry point.

    Returns the :class:`RefreshResult`, or ``None`` if the catalog was fresh
    enough that no check was made.
    """
    moment = now or _utcnow()
    if not is_stale(read_status(conn), now=moment):
        logger.info("Scryfall catalog is fresh; skipping refresh check")
        return None
    return refresh_catalog(conn, client=client, now=moment)
