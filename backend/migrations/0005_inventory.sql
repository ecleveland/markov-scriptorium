-- 0005_inventory — owned card inventory (VEG-217, ADR 0009).
--
-- One row per acquisition LOT of an owned printing. Each lot carries its own
-- quantity and (optional) acquisition date / price, so the same physical folio
-- bought twice keeps a distinct cost basis. Total owned of a folio is
-- SUM(quantity) grouped by (scryfall_id, finish, condition, language) — there is
-- deliberately NO unique constraint on that tuple (the "lot" model).
--
-- A folio is (printing × finish × condition × language × location):
--   * scryfall_id pins the printing — same card in two sets = two printings =
--     two records, for free, since it is the per-printing FK into `cards`.
--   * finish keeps foil / nonfoil / etched as separate rows (Scryfall's terms).
--   * condition uses the standard TCG grades.
--
-- The FK RESTRICTs rather than CASCADEs (the opposite of card_faces): the card
-- catalog is full-replaced on every bulk Scryfall refresh, and owned inventory
-- must never be deleted out from under the user by that churn or by a stray
-- card delete.
--
-- `location` is free text for now; VEG-279 owns promoting Volumes to a managed
-- entity and will migrate this column to an FK. `tags` is a JSON array and
-- `price_paid` a TEXT decimal, matching the conventions in `cards`.

CREATE TABLE inventory (
    id          INTEGER PRIMARY KEY,                        -- surrogate lot key
    scryfall_id TEXT NOT NULL REFERENCES cards(scryfall_id)
                  ON UPDATE CASCADE ON DELETE RESTRICT,     -- printing FK; protect owned rows
    quantity    INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
    finish      TEXT NOT NULL DEFAULT 'nonfoil'
                  CHECK (finish IN ('nonfoil', 'foil', 'etched')),
    condition   TEXT NOT NULL DEFAULT 'NM'
                  CHECK (condition IN ('NM', 'LP', 'MP', 'HP', 'DMG')),
    language    TEXT NOT NULL DEFAULT 'en',                 -- printing lang; catalog is EN-only
    location    TEXT,                                       -- free-text Volume (see VEG-279)
    acquired_at TEXT,                                       -- ISO date, optional
    price_paid  TEXT,                                       -- decimal string, optional
    notes       TEXT,
    tags        TEXT                                        -- JSON array, optional
);

-- Backs "ownership of this printing" lookups and the SUM(quantity) folio rollup.
CREATE INDEX idx_inventory_scryfall_id ON inventory (scryfall_id);
