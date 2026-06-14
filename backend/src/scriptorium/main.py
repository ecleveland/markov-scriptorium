"""The Markov Scriptorium backend — FastAPI application entry point."""

from __future__ import annotations

from fastapi import FastAPI

from scriptorium.db import healthcheck

app = FastAPI(
    title="The Markov Scriptorium",
    description="A candlelit catalog of a Magic: The Gathering collection.",
    version="0.1.0",
)


@app.get("/")
def root() -> dict[str, str]:
    """Greeting from the scriptorium."""
    return {"message": "The Markov Scriptorium keeps its candles lit."}


@app.get("/health")
def health() -> dict[str, str]:
    """Liveness check, including a probe of the local catalog database."""
    return {"status": "ok", "database": "ok" if healthcheck() else "unavailable"}
