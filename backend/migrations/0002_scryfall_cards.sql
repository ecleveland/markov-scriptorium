-- 0002_scryfall_cards — local Scryfall card catalog (VEG-211, ADR 0005).
--
-- Two tables model Scryfall's printing data:
--   * cards       — one row per PRINTING, keyed by the Scryfall id (canonical FK).
--   * card_faces  — child rows for multi-faced layouts (transform, modal_dfc,
--                   split, flip, adventure). Single-faced cards have none.
--
-- Per-printing columns that differ per face (mana_cost, type_line, oracle_text,
-- colors, image_uris) may be NULL on the cards row when they live per-face.
-- Bulk-data fields kept as JSON text (legalities, image_uris, finishes, colors)
-- are stored verbatim — not normalized — since they aren't MVP query targets.
-- Prices are a snapshot, overwritten wholesale on each bulk refresh.

CREATE TABLE cards (
    scryfall_id      TEXT PRIMARY KEY,          -- Scryfall `id` (printing UUID)
    oracle_id        TEXT,                      -- groups printings of one card
    name             TEXT NOT NULL,             -- "Front // Back" when multifaced
    set_code         TEXT NOT NULL,             -- Scryfall `set` (reserved word)
    set_name         TEXT NOT NULL,
    collector_number TEXT NOT NULL,             -- text: can hold ★, letters, etc.
    rarity           TEXT NOT NULL,
    lang             TEXT NOT NULL,
    released_at      TEXT,                      -- ISO date string
    layout           TEXT NOT NULL,             -- normal, transform, split, ...
    mana_cost        TEXT,
    cmc              REAL,                      -- mana value; fractional on un-cards
    type_line        TEXT,
    oracle_text      TEXT,
    colors           TEXT,                      -- JSON array, e.g. ["B","R","W"]
    color_identity   TEXT,                      -- JSON array
    finishes         TEXT,                      -- JSON array, e.g. ["nonfoil","foil"]
    legalities       TEXT,                      -- JSON object {format: status}
    image_uris       TEXT,                      -- JSON object; NULL when per-face
    price_usd        TEXT,
    price_usd_foil   TEXT,
    price_usd_etched TEXT,
    price_eur        TEXT,
    price_eur_foil   TEXT,
    price_tix        TEXT,
    scryfall_uri     TEXT                       -- link back to the card page
);

CREATE TABLE card_faces (
    scryfall_id TEXT NOT NULL REFERENCES cards(scryfall_id) ON DELETE CASCADE,
    face_index  INTEGER NOT NULL,              -- 0 = front
    name        TEXT NOT NULL,
    mana_cost   TEXT,
    type_line   TEXT,
    oracle_text TEXT,
    colors      TEXT,                          -- JSON array
    image_uris  TEXT,                          -- JSON object
    PRIMARY KEY (scryfall_id, face_index)
);

-- Search/lookup indexes. NOCASE on name backs local case-insensitive
-- autocomplete; the (set_code, collector_number) pair backs scanner
-- disambiguation; oracle_id backs "ownership across printings".
CREATE INDEX idx_cards_name ON cards (name COLLATE NOCASE);
CREATE INDEX idx_cards_oracle_id ON cards (oracle_id);
CREATE INDEX idx_cards_set_code ON cards (set_code);
CREATE INDEX idx_cards_set_collector ON cards (set_code, collector_number);
CREATE INDEX idx_card_faces_name ON card_faces (name COLLATE NOCASE);
