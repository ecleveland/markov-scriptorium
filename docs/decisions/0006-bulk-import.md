# 0006 — Scryfall Bulk Import Strategy

**Status:** accepted (2026-06-15)

Resolves [VEG-213]. Decides how the downloaded Scryfall bulk export
([VEG-212]) is parsed and loaded into the `cards` / `card_faces` tables
([0005](0005-scryfall-card-schema.md)). Ships as
`scriptorium/scryfall/importer.py`.

[VEG-213]: https://linear.app/vega-apps/issue/VEG-213
[VEG-212]: https://linear.app/vega-apps/issue/VEG-212

---

## Decision

`import_bulk_file(conn, path)` stream-parses the bulk JSON and full-replaces the
card tables in one transaction:

- **Streaming parse with `ijson`** (`use_float=True`) — iterates the bulk array
  one card object at a time, so the ~1.5 GB decompressed file never lands in
  memory. `use_float=True` makes ijson yield plain floats (e.g. `cmc`) rather
  than `decimal.Decimal`, which `sqlite3` cannot bind. Input is opened through
  `gzip` when the path ends in `.gz`, else as plain bytes.
- **Full replace in a single transaction** — `DELETE FROM card_faces`, then
  `DELETE FROM cards` (child before parent for the foreign key), then batched
  `executemany` inserts (5,000 rows/batch, cards before faces so the FK parent
  always exists). A mid-import failure rolls back, leaving the prior catalog
  intact; a clean run is idempotent and exactly mirrors the file.
- **Mapping** — scalars map straight across (`id→scryfall_id`, `set→set_code`,
  …); `colors`, `color_identity`, `finishes`, `legalities`, `image_uris` are
  `json.dumps`-ed into their TEXT columns (the importer owns this serialization,
  per ADR 0005); `prices.*` spread into the discrete price columns;
  `card_faces[]` become `card_faces` rows indexed by position. Absent optional
  fields become SQL `NULL`.
- **Errors** — the importer owns its transaction with explicit
  `BEGIN`/`COMMIT`/`ROLLBACK` (so atomicity holds regardless of the
  connection's isolation/autocommit mode), and converts the realistic failure
  modes into `BulkImportError`: a malformed/non-dict card object, a corrupt or
  truncated file (ijson/gzip errors), and a constraint violation at insert
  (e.g. a duplicate `scryfall_id`). Every path rolls back to the prior catalog.

---

## Alternatives Considered

- **Stdlib `json.load`** — rejected. Reads the entire ~1.5 GB into memory as
  Python objects (several GB of RAM); not viable for the real file without
  hand-rolling a chunked array parser. `ijson` is the purpose-built tool the
  ticket suggested; small, stable, C-backed with a pure-Python fallback.
- **Upsert (`INSERT … ON CONFLICT DO UPDATE`) + sweep** — deferred. It is
  foreign-key-safe (updates card rows in place rather than deleting them, so it
  wouldn't cascade-delete future inventory rows) but is more complex and
  protects references that don't exist yet — there is no inventory table until
  M3. Note `INSERT OR REPLACE` is *not* a safe substitute: it does DELETE+INSERT
  and would cascade-delete children once they exist.

---

## Consequences

- **Full replace is destructive by design** — every import clears both tables.
  Safe today (nothing references `cards`), but **M3 must revisit this** when the
  inventory/deck tables add foreign keys to `cards`: a blind `DELETE FROM cards`
  would cascade into owned-card records. The likely pivot is upsert + a guarded
  sweep that never deletes a printing a user owns. Flagged here so it isn't a
  surprise.
- **New runtime dependency: `ijson`** (with a mypy `ignore_missing_imports`
  override — it ships no stubs).
- The importer takes an open connection and owns only the transaction, matching
  the existing `db`/migrations split. Orchestration (download-then-import,
  staleness checks) is [VEG-214].
- Progress is logged every 25k cards plus a final summary; counts are returned
  as `ImportResult` for callers/tests.
