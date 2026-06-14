"""The Markov Scriptorium backend — FastAPI application entry point."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, closing

from fastapi import FastAPI

from scriptorium.db import connect, healthcheck
from scriptorium.migrations import apply_migrations


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Bring the catalog schema up to date before serving requests."""
    with closing(connect()) as conn:
        apply_migrations(conn)
    yield


app = FastAPI(
    title="The Markov Scriptorium",
    description="A candlelit catalog of a Magic: The Gathering collection.",
    version="0.1.0",
    lifespan=lifespan,
)


@app.get("/")
def root() -> dict[str, str]:
    """Greeting from the scriptorium."""
    return {"message": "The Markov Scriptorium keeps its candles lit."}


@app.get("/health")
def health() -> dict[str, str]:
    """Liveness check, including a probe of the local catalog database."""
    return {"status": "ok", "database": "ok" if healthcheck() else "unavailable"}
