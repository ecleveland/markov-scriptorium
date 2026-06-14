"""Hand-rolled schema migrations for the local catalog (see ADR 0004).

Migrations are plain ``.sql`` files in ``backend/migrations/`` named
``NNNN_description.sql`` (e.g. ``0001_initial.sql``). Each file's leading
number is its version. The applied version is tracked in the database itself
via SQLite's ``PRAGMA user_version``, so no bookkeeping table is needed.

On startup the app applies every migration whose version is greater than the
database's current ``user_version``, each wrapped in a transaction so a failing
migration leaves the catalog untouched. Conventions:

- Migrations are forward-only and never edited once shipped — add a new file.
- Write plain DDL; do **not** include ``BEGIN``/``COMMIT`` (the runner wraps
  each migration in its own transaction).
"""

from __future__ import annotations

import re
import sqlite3
from pathlib import Path

# backend/src/scriptorium/migrations.py -> backend/ is two parents up.
_MIGRATIONS_DIR = Path(__file__).resolve().parents[2] / "migrations"
_VERSION_PREFIX = re.compile(r"^(\d+)")


def _discover(migrations_dir: Path) -> list[tuple[int, Path]]:
    """Return ``(version, path)`` for each numbered ``.sql`` file, version-sorted."""
    found: list[tuple[int, Path]] = []
    for path in migrations_dir.glob("*.sql"):
        match = _VERSION_PREFIX.match(path.name)
        if match:
            found.append((int(match.group(1)), path))
    return sorted(found)


def apply_migrations(conn: sqlite3.Connection, migrations_dir: Path | None = None) -> int:
    """Apply every pending migration to ``conn``; return the resulting version."""
    directory = migrations_dir or _MIGRATIONS_DIR
    current = int(conn.execute("PRAGMA user_version").fetchone()[0])
    for version, path in _discover(directory):
        if version <= current:
            continue
        # Wrap each migration + its version bump in one transaction. executescript
        # does not roll back on a mid-script error, so roll back explicitly to
        # leave the catalog untouched and retry the migration on the next startup.
        try:
            conn.executescript(
                f"BEGIN;\n{path.read_text()}\nPRAGMA user_version = {version};\nCOMMIT;"
            )
        except Exception:
            conn.rollback()
            raise
        current = version
    return current
