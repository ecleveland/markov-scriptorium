"""Hand-rolled schema migrations for the local catalog (see ADR 0004).

Migrations are plain ``.sql`` files in ``backend/migrations/`` named
``NNNN_description.sql`` (e.g. ``0001_initial.sql``). Each file's leading
number is its version. The applied version is tracked in the database itself
via SQLite's ``PRAGMA user_version``, so no bookkeeping table is needed.

On startup the app applies every migration whose version is greater than the
database's current ``user_version``, each wrapped in a transaction so a failing
migration leaves the catalog untouched. Conventions:

- Migrations are forward-only and never edited once shipped — add a new file.
- Write plain DDL. A migration must **not** contain its own ``BEGIN`` /
  ``COMMIT`` / ``ROLLBACK``: the runner injects its own transaction around each
  file, so an inner one would close it early and break atomicity. This is
  enforced (such a migration is rejected), not merely advised.
"""

from __future__ import annotations

import re
import sqlite3
from pathlib import Path

# backend/src/scriptorium/migrations.py -> backend/ is two parents up.
_MIGRATIONS_DIR = Path(__file__).resolve().parents[2] / "migrations"
_VERSION_PREFIX = re.compile(r"^(\d+)")
_TXN_CONTROL = re.compile(r"\b(?:BEGIN|COMMIT|ROLLBACK)\b", re.IGNORECASE)


class MigrationError(RuntimeError):
    """Raised when migrations can't be discovered or a migration fails to apply."""


def _discover(migrations_dir: Path) -> list[tuple[int, Path]]:
    """Return ``(version, path)`` for each numbered ``.sql`` file, version-sorted.

    Raises :class:`MigrationError` if the directory is missing (a packaging or
    configuration bug we'd rather surface than silently skip) or if two files
    share a version number (which would otherwise drop one migration silently).
    """
    if not migrations_dir.is_dir():
        raise MigrationError(f"migrations directory not found: {migrations_dir}")
    by_version: dict[int, Path] = {}
    for path in sorted(migrations_dir.glob("*.sql")):
        match = _VERSION_PREFIX.match(path.name)
        if not match:
            continue  # not a numbered migration (e.g. notes.sql) — ignore
        version = int(match.group(1))
        if version in by_version:
            raise MigrationError(
                f"duplicate migration version {version}: {by_version[version].name} and {path.name}"
            )
        by_version[version] = path
    return sorted(by_version.items())


def _has_transaction_control(sql: str) -> bool:
    """True if the SQL (ignoring ``--`` line comments) uses BEGIN/COMMIT/ROLLBACK."""
    without_comments = "\n".join(line.split("--", 1)[0] for line in sql.splitlines())
    return _TXN_CONTROL.search(without_comments) is not None


def apply_migrations(conn: sqlite3.Connection, migrations_dir: Path | None = None) -> int:
    """Apply every pending migration to ``conn``; return the resulting version."""
    directory = migrations_dir or _MIGRATIONS_DIR
    current = int(conn.execute("PRAGMA user_version").fetchone()[0])
    for version, path in _discover(directory):
        if version <= current:
            continue
        sql = path.read_text()
        if _has_transaction_control(sql):
            raise MigrationError(
                f"migration {path.name} must not contain BEGIN/COMMIT/ROLLBACK; "
                "the runner wraps each migration in its own transaction"
            )
        # Wrap each migration + its version bump in one transaction. executescript
        # does not roll back on a mid-script error, so on failure roll back the
        # injected (never-committed) transaction explicitly, leaving the catalog at
        # its previous version so the migration retries on the next startup.
        try:
            conn.executescript(f"BEGIN;\n{sql}\nPRAGMA user_version = {version};\nCOMMIT;")
        except sqlite3.Error as exc:
            conn.rollback()
            raise MigrationError(f"migration {path.name} failed: {exc}") from exc
        current = version
    return current
