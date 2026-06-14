# 0004 — Schema Migration Strategy: Hand-Rolled SQL Runner

**Status:** accepted (2026-06-14)

Resolves [VEG-278]. Decides how the SQLite catalog schema evolves over time,
established before any real data exists. Builds on [0001](0001-foundational-architecture.md)
(SQLite, local-first) and the raw `sqlite3` data layer in `backend/src/scriptorium/db.py`.

[VEG-278]: https://linear.app/vega-apps/issue/VEG-278

---

## Decision

Hand-rolled, versioned SQL migrations — no ORM:

- Plain `NNNN_description.sql` files in `backend/migrations/` (e.g. `0001_initial.sql`).
- A small stdlib runner (`scriptorium/migrations.py`) applies every file whose leading
  number exceeds the database's `PRAGMA user_version`, each wrapped in a transaction with an
  explicit rollback on failure, then bumps `user_version`. No bookkeeping table needed.
- Applied automatically on app startup via a FastAPI `lifespan` handler.
- Forward-only; migrations are never edited once shipped.

---

## Alternatives Considered

- **Alembic + SQLAlchemy** — rejected. It pairs with an ORM, which would replace the
  raw-`sqlite3` layer and pull in two heavy dependencies. Autogeneration's payoff is low for
  ~a dozen hand-written tables in a single-developer local app, and it carries the most
  learning/maintenance surface.
- **yoyo-migrations** — rejected. A reasonable middle option (raw SQL + rollback, no ORM), but
  it adds a dependency for rollback/CLI features a personal, forward-only tool doesn't need.

---

## Reasoning

Matches the project's stated priorities: local-first single-file SQLite, single-developer
maintainability, boring/durable tooling, and the owner learning SQL directly. Zero new
dependencies; the mechanism is transparent (~40 lines) and leans on SQLite's own
`user_version`. The schema-design tickets ([VEG-211], [VEG-217], [VEG-222]) each ship their
tables as a migration on top of this.

[VEG-211]: https://linear.app/vega-apps/issue/VEG-211
[VEG-217]: https://linear.app/vega-apps/issue/VEG-217
[VEG-222]: https://linear.app/vega-apps/issue/VEG-222

---

## Consequences

- Every schema change is a new `NNNN_*.sql` file; shipped migrations are never edited.
- **No autogeneration** — tables are written by hand (acceptable at this scale).
- **Forward-only** — there are no down-migrations; to undo, write a new forward migration.
- **Atomicity** — each migration runs in a transaction and rolls back on error, so a failure
  leaves the catalog at its previous version and retries on the next startup.
- **Validation** — the runner raises `MigrationError` (rather than failing silently) on
  misconfiguration: a missing migrations directory, two files sharing a version number, or a
  migration that contains its own `BEGIN`/`COMMIT`/`ROLLBACK` (which would break the wrapping
  transaction). Startup logs the failing migration before aborting.
- **Packaging note:** migrations live at `backend/migrations/`, *outside* the wheel package
  (`src/scriptorium`). The dev/editable path resolves them by filesystem path today, but the
  Tauri/PyInstaller build (M7 — [VEG-364]/[VEG-366]) must explicitly bundle this directory.
- **FK enforcement** (`PRAGMA foreign_keys`) is a per-connection runtime concern, handled when
  foreign-key schemas land — not by the migration runner.

[VEG-364]: https://linear.app/vega-apps/issue/VEG-364
[VEG-366]: https://linear.app/vega-apps/issue/VEG-366
