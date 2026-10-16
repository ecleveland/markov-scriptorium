"""The Markov Scriptorium backend — FastAPI application entry point."""

from __future__ import annotations

import asyncio
import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, closing, suppress
from datetime import UTC, datetime
from typing import Any

from fastapi import BackgroundTasks, FastAPI

from scriptorium import archive
from scriptorium.api.archive import router as archive_router
from scriptorium.api.cards import router as cards_router
from scriptorium.api.decks import router as decks_router
from scriptorium.api.inventory import router as inventory_router
from scriptorium.api.onboarding import router as onboarding_router
from scriptorium.db import connect, healthcheck
from scriptorium.migrations import apply_migrations, pending_migrations
from scriptorium.scryfall.refresh import is_stale, maybe_refresh, read_status, refresh_catalog

logger = logging.getLogger("scriptorium")

# Values that disable the startup refresh; anything else (including unset) leaves
# it on, so a fresh install keeps its catalog current without configuration.
_AUTO_REFRESH_OFF = {"0", "false", "no", "off"}


def _auto_refresh_enabled() -> bool:
    """Whether to run the Scryfall refresh on startup (SCRIPTORIUM_AUTO_REFRESH)."""
    return os.environ.get("SCRIPTORIUM_AUTO_REFRESH", "1").strip().lower() not in _AUTO_REFRESH_OFF


def _run_startup_refresh() -> None:
    """Staleness-gated refresh for startup; failures are logged, never raised.

    A broken refresh (no network, corrupt download) must not take down the app —
    the catalog simply stays at its last-good version until the next attempt.
    """
    try:
        with closing(connect()) as conn:
            maybe_refresh(conn)
    except Exception:
        logger.exception("startup Scryfall refresh failed")


def _run_manual_refresh() -> None:
    """Forced (version-aware) refresh behind the manual trigger; failures logged.

    Unlike startup, this ignores the staleness window — the user asked for it —
    but still skips the heavy re-import when Scryfall's published version is
    unchanged.
    """
    try:
        with closing(connect()) as conn:
            refresh_catalog(conn)
    except Exception:
        logger.exception("manual Scryfall refresh failed")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Back up, migrate the catalog, then kick off a background refresh, before serving."""
    with closing(connect()) as conn:
        # A schema change on a catalog holding the user's lots or Tomes gets a
        # backup first. If that backup fails, startup stops before migrating, so
        # no schema change ever runs without a copy to return to. A fresh copy
        # already taken for this version is kept as is, so a migration that
        # fails on every start does not prune the copy from its first attempt.
        try:
            if pending_migrations(conn) and archive.has_user_data(conn):
                current = int(conn.execute("PRAGMA user_version").fetchone()[0])
                if archive.has_fresh_premigration_backup(current):
                    logger.info(
                        "a pre-migration backup of schema version %d exists; not sealing another",
                        current,
                    )
                else:
                    backup = archive.take_backup("premigration")
                    logger.info("sealed a pre-migration backup at %s", backup.path)
            version = apply_migrations(conn)
            logger.info("catalog schema ready at version %d", version)
        except archive.BackupError:
            logger.exception("pre-migration backup failed; refusing to migrate")
            raise
        except Exception:
            logger.exception("catalog migration failed during startup")
            raise

    # Run the refresh off the event loop (httpx + sqlite are blocking) and don't
    # await it — startup must not wait on a ~500 MB download.
    refresh_task: asyncio.Task[None] | None = None
    if _auto_refresh_enabled():
        refresh_task = asyncio.create_task(asyncio.to_thread(_run_startup_refresh))
    else:
        logger.info("auto-refresh disabled (SCRIPTORIUM_AUTO_REFRESH); skipping startup refresh")

    try:
        yield
    finally:
        if refresh_task is not None:
            if not refresh_task.done():
                refresh_task.cancel()
            with suppress(asyncio.CancelledError):
                await refresh_task


app = FastAPI(
    title="The Markov Scriptorium",
    description="A candlelit catalog of a Magic: The Gathering collection.",
    version="0.1.0",
    lifespan=lifespan,
)

app.include_router(archive_router)
app.include_router(cards_router)
app.include_router(decks_router)
app.include_router(inventory_router)
app.include_router(onboarding_router)


@app.get("/")
def root() -> dict[str, str]:
    """Greeting from the scriptorium."""
    return {"message": "The Markov Scriptorium keeps its candles lit."}


@app.get("/health")
def health() -> dict[str, str]:
    """Liveness check, including a probe of the local catalog database."""
    return {"status": "ok", "database": "ok" if healthcheck() else "unavailable"}


@app.get("/scryfall/status")
def scryfall_status() -> dict[str, Any]:
    """Report when the local Scryfall catalog was last refreshed."""
    with closing(connect()) as conn:
        status = read_status(conn)
        stale = is_stale(status, now=datetime.now(UTC))
    return {
        "last_checked_at": status.last_checked_at if status else None,
        "source_updated_at": status.source_updated_at if status else None,
        "imported_at": status.imported_at if status else None,
        "card_count": status.card_count if status else None,
        "face_count": status.face_count if status else None,
        "stale": stale,
    }


@app.post("/scryfall/refresh", status_code=202)
def scryfall_refresh(background_tasks: BackgroundTasks) -> dict[str, str]:
    """Trigger a catalog refresh in the background; returns immediately (202)."""
    background_tasks.add_task(_run_manual_refresh)
    return {"message": "The scriptorium begins transcribing the latest folios."}
