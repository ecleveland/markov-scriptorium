-- 0003_scryfall_refresh — last-refresh bookkeeping for the bulk pipeline (VEG-214, ADR 0007).
--
-- The auto-refresh mechanism records when the local Scryfall catalog was last
-- checked against / imported from Scryfall's bulk export, so it can decide
-- whether the data is stale (>24h since last check) and skip the heavy re-import
-- when the published version hasn't changed. Exposed read-only via /scryfall/status.
--
-- One metadata row, pinned to id = 1 by a CHECK so there is exactly one place
-- the refresh state lives. All timestamps are ISO-8601 UTC strings.

CREATE TABLE scryfall_refresh (
    id                INTEGER PRIMARY KEY CHECK (id = 1),
    last_checked_at   TEXT,     -- when we last asked Scryfall for the bulk listing
    source_updated_at TEXT,     -- Scryfall `updated_at` of the imported export (the version)
    imported_at       TEXT,     -- when the last successful import completed
    file              TEXT,     -- path of the imported bulk file on disk
    card_count        INTEGER,  -- rows written to `cards` by the last import
    face_count        INTEGER   -- rows written to `card_faces` by the last import
);
