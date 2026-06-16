# 0007 — Scryfall Auto-Refresh Mechanism

**Status:** accepted (2026-06-16)

Resolves [VEG-214]. Decides how the local catalog is kept current by tying the
downloader ([VEG-212], [0006](0006-bulk-import.md)) and importer ([VEG-213]) into
one staleness-gated refresh that runs in the background on startup and via a
manual trigger. Ships as `scriptorium/scryfall/refresh.py`, migration `0003`, and
two endpoints in `main.py`.

[VEG-214]: https://linear.app/vega-apps/issue/VEG-214
[VEG-213]: https://linear.app/vega-apps/issue/VEG-213
[VEG-212]: https://linear.app/vega-apps/issue/VEG-212

---

## Decision

**Refresh state lives in a one-row table.** Migration `0003` adds
`scryfall_refresh` (pinned to `id = 1` by a `CHECK`) recording `last_checked_at`,
`source_updated_at` (Scryfall's `updated_at` of the imported export — the
version), `imported_at`, `file`, and the `card_count` / `face_count` from the
last import. A dedicated typed table (over a generic key-value store) matches the
existing schema style and is trivial to read for the status endpoint.

**Two-level refresh.**

- `refresh_catalog(conn, *, client, force, now)` always contacts Scryfall: it
  fetches the cheap `/bulk-data` listing and compares the published version to
  `source_updated_at`. If unchanged (and not `force`), it records the check and
  returns *without* the ~1.5 GB download/import — the export only changes about
  once a day, so re-importing an identical file is pure waste. Otherwise it
  downloads (reusing the already-fetched listing entry, so no second list call)
  and full-replaces the catalog via `import_bulk_file`, then records the new
  version. Metadata is written only after the step it describes succeeds.
- `maybe_refresh(conn, ...)` is the startup gate: it runs `refresh_catalog` only
  when the catalog is **stale** — never refreshed, or `last_checked_at` is ≥24h
  old (`REFRESH_MAX_AGE`). This keeps a restart from re-hitting Scryfall on every
  launch.

**Staleness is gauged by last *check*, not last *import*.** The 24h window exists
to bound how often we talk to Scryfall, so it keys off when we last looked. The
version comparison then decides whether the look turns into an import. This is
faithful to the ticket's ">24 hours since last download" while avoiding a needless
re-import when nothing changed.

**Startup runs it in the background.** The FastAPI lifespan, after migrations,
launches the refresh with `asyncio.create_task(asyncio.to_thread(...))` — off the
event loop (httpx + sqlite are blocking) and un-awaited, so a ~500 MB download
never blocks startup. Failures are logged and swallowed: a broken refresh leaves
the catalog at its last-good version rather than taking down the app. The hook is
gated by `SCRIPTORIUM_AUTO_REFRESH` (on unless set to `0`/`false`/`no`/`off`), so
the test suite and offline runs can disable it.

**Two endpoints.** `GET /scryfall/status` reports the last-refresh metadata and a
computed `stale` flag (the ticket's "visible via API"). `POST /scryfall/refresh`
schedules a background refresh and returns `202`; the manual path uses
`refresh_catalog` directly so it ignores the staleness window (the user asked for
it) while still skipping the import when the version is unchanged.

---

## Alternatives Considered

- **Recurring scheduler** (re-check every N hours while running) — deferred. The
  ticket asks for startup + manual only; for a locally-run desktop app a restart
  is a natural re-check point. A long-lived background loop adds a task to
  supervise and interval config for no current benefit. Easy to add later.
- **Pure 24h time gate** (always re-download + re-import when >24h old, ignoring
  the published version) — rejected. Simpler, but re-imports ~1.5 GB even when
  Scryfall hasn't published anything new. The version skip is one cheap list call
  to avoid that.
- **Generic `app_metadata(key, value)` table** — rejected for now. More reusable
  but untyped and less self-documenting than explicit columns; revisit if other
  one-off metadata appears.

---

## Consequences

- **New `SCRIPTORIUM_AUTO_REFRESH` env flag.** Defaults on; documented here and
  in the start-ticket overrides' implicit env surface.
- **`download_bulk` gained an optional `entry` parameter** so the orchestrator
  can pass the listing it already fetched and skip a redundant `/bulk-data`
  request. Backward compatible (defaults to fetching).
- **Inherits the full-replace caveat from [0006](0006-bulk-import.md).** Each
  import still clears `cards` / `card_faces`; once M3 adds inventory/deck tables
  referencing `cards`, the refresh must move to the upsert + guarded-sweep plan
  flagged there before it can run unattended.
- **Shutdown abandons an in-flight refresh.** On app shutdown the lifespan
  cancels the task; the underlying worker thread runs to completion in the
  background. Acceptable for a single-user local app.
