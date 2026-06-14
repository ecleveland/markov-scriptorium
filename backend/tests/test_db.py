"""Tests for the catalog database helpers."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from scriptorium import db


def test_healthcheck_closes_its_connection(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("SCRIPTORIUM_DB_PATH", str(tmp_path / "catalog.db"))

    opened: list[sqlite3.Connection] = []
    real_connect = db.connect

    def tracking_connect() -> sqlite3.Connection:
        conn = real_connect()
        opened.append(conn)
        return conn

    monkeypatch.setattr(db, "connect", tracking_connect)

    assert db.healthcheck() is True
    assert opened, "healthcheck did not open a connection"

    # Operating on a closed sqlite3 connection raises ProgrammingError; if the
    # connection were leaked (left open), this SELECT would succeed instead.
    for conn in opened:
        with pytest.raises(sqlite3.ProgrammingError):
            conn.execute("SELECT 1")
