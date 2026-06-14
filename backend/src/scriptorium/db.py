"""SQLite connection handling for the local catalog.

The catalog lives in a single local SQLite file (see ADR 0001). Its location
can be overridden with the ``SCRIPTORIUM_DB_PATH`` environment variable;
otherwise it defaults to ``data/scriptorium.db`` at the repository root.

No schema is defined yet — that arrives with the Scryfall and inventory
milestones (M2/M3), alongside a migration strategy (VEG-278). For now this
module only establishes how the backend reaches the catalog file.
"""

from __future__ import annotations

import os
import sqlite3
from contextlib import closing
from pathlib import Path

# backend/src/scriptorium/db.py -> repository root is four parents up.
_REPO_ROOT = Path(__file__).resolve().parents[3]
_DEFAULT_DB_PATH = _REPO_ROOT / "data" / "scriptorium.db"


def db_path() -> Path:
    """Resolve the catalog database path (env override or default)."""
    override = os.environ.get("SCRIPTORIUM_DB_PATH")
    return Path(override) if override else _DEFAULT_DB_PATH


def connect() -> sqlite3.Connection:
    """Open a connection to the catalog, creating the data directory if needed.

    The caller owns the connection and must close it (e.g. wrap it in
    ``contextlib.closing``) — a bare ``with`` block only manages the
    transaction, not the connection's lifetime.
    """
    path = db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    return conn


def healthcheck() -> bool:
    """Return ``True`` if the catalog database is reachable."""
    try:
        with closing(connect()) as conn:
            conn.execute("SELECT 1")
        return True
    except sqlite3.Error:
        return False
