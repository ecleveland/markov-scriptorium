"""Archive endpoints (VEG-281, ADR 0023): seal backups and export the collection.

Backups are local copies of the catalog file under ``backups/`` beside it. A
manual backup is refused with a 409 while a writer, usually the Scryfall
importer, holds the catalog, because the copy would otherwise wait out the
whole import. Exports are downloads of the user's inventory and Tomes as CSV
or JSON. Everything stays on local disk.
"""

from __future__ import annotations

import sqlite3
import time
from collections.abc import Iterator
from contextlib import closing, contextmanager
from dataclasses import asdict
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Response
from fastapi.responses import JSONResponse

from scriptorium import archive
from scriptorium.db import connect

router = APIRouter(prefix="/archive", tags=["archive"])

_BUSY_DETAIL = (
    "The scribes are still transcribing the catalog. Seal a copy once the refresh completes."
)


@contextmanager
def _busy_catalog_as_409() -> Iterator[None]:
    """Turn a read blocked by a writer, such as a Scryfall refresh, into a 409."""
    try:
        yield
    except sqlite3.OperationalError as exc:
        if "locked" in str(exc):
            raise HTTPException(status_code=409, detail=_BUSY_DETAIL) from exc
        raise


def _attachment(extension: str) -> dict[str, str]:
    """A Content-Disposition header naming today's export file."""
    stamp = datetime.now(UTC).strftime("%Y%m%d")
    return {"Content-Disposition": f'attachment; filename="scriptorium-{stamp}.{extension}"'}


@router.get("/backups")
def list_backups() -> dict[str, Any]:
    """The backups directory, each pool's keep count, and every backup, newest first."""
    try:
        directory = archive.backups_dir()
        backups = archive.list_backups()
    except archive.BackupError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {
        "directory": str(directory),
        "keep": archive.manual_keep(),
        "premigration_keep": archive.PREMIGRATION_KEEP,
        "daily_keep": archive.DAILY_KEEP,
        "backups": [asdict(backup) for backup in backups],
    }


@router.post("/backups", status_code=201)
def seal_backup() -> dict[str, Any]:
    """Take a manual backup now and return it."""
    try:
        try:
            backup = archive.take_backup("manual")
        except archive.BackupCollisionError:
            # Two requests in the same second share a filename. Wait for the
            # next second and try once more.
            time.sleep(1)
            backup = archive.take_backup("manual")
    except archive.BackupBusyError as exc:
        raise HTTPException(status_code=409, detail=_BUSY_DETAIL) from exc
    except archive.BackupError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return asdict(backup)


@router.get("/export.csv")
def export_csv() -> Response:
    """Download every inventory lot as a Manabox-style CSV."""
    with _busy_catalog_as_409(), closing(connect()) as conn:
        content = archive.export_csv(conn)
    return Response(
        content=content, media_type="text/csv; charset=utf-8", headers=_attachment("csv")
    )


@router.get("/export.json")
def export_json() -> JSONResponse:
    """Download every inventory lot and Tome as one JSON document."""
    with _busy_catalog_as_409(), closing(connect()) as conn:
        document = archive.export_json(conn)
    return JSONResponse(document, headers=_attachment("json"))
