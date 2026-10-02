-- 0006_decks: Tomes and their card slots (VEG-222, ADR 0018).
--
-- A Tome is one `decks` row plus one `deck_cards` row per SLOT. A slot is
-- (deck x printing x finish x board) with a quantity. It references a printing
-- in the catalog, never an inventory lot. A Tome says what it wants, inventory
-- says what is owned, and "owned vs needed" is a join between the two. A card
-- the user does not own is an ordinary slot with no matching inventory.
--
-- A slot matches owned copies on (scryfall_id, finish), summing inventory
-- across condition, language and location. Foil and non-foil stay separate,
-- as everywhere. A copy owned in another printing is a swap hint
-- (owned_across_printings), not a match; changing the slot's printing is a
-- PATCH.
--
-- Commander and companion are boards, not deck columns, so they reserve and
-- break down like any other sleeved card. They hold one copy per row, and
-- partners are two rows with different printings. Maybeboard rows never claim
-- cards. Every reservation and breakdown query excludes board = 'maybeboard'.
--
-- claims_cards is the hybrid flag (PROJECT Key Decision 5). 1 means the Tome
-- reserves its cards (sleeved), 0 means it only references them (a brew
-- folder). Default 1. Reservation is computed at read time, never stored.
--
-- deck_cards -> decks CASCADEs. Slots belong to their Tome, and deleting a
-- Tome releases its reservations without touching inventory. deck_cards ->
-- cards RESTRICTs, mirroring inventory (ADR 0009). A Scryfall refresh or a
-- stray card delete must not empty a Tome.
--
-- format is free text holding a lowercase Scryfall `legalities` key
-- ('commander', 'modern', ...) or 'cube' / 'brew', NULL when unset; the app
-- validates it. Scryfall adds formats, and a CHECK in SQLite can only change
-- by rebuilding the table. status is a CHECK because its four values are ours
-- and stable. changelog is plain text the user writes, like notes.
--
-- No triggers. The migration runner rejects transaction keywords, and a
-- trigger body needs one. So updated_at only gets a default here, and every
-- write path in the app sets it. Over-reservation is also app logic (VEG-224).

CREATE TABLE decks (
    id           INTEGER PRIMARY KEY,                       -- surrogate Tome key
    name         TEXT NOT NULL CHECK (trim(name) <> ''),
    format       TEXT,                                      -- lowercase legalities key, 'cube', 'brew'; NULL = unset
    status       TEXT NOT NULL DEFAULT 'in_progress'
                   CHECK (status IN ('in_progress', 'active', 'playtest', 'shelved')),
    claims_cards INTEGER NOT NULL DEFAULT 1
                   CHECK (claims_cards IN (0, 1)),          -- 1 = reserved, 0 = referenced
    notes        TEXT,
    changelog    TEXT,                                      -- user-written journal
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))  -- app sets on every write
);

CREATE TABLE deck_cards (
    id          INTEGER PRIMARY KEY,                        -- surrogate slot key (the :card_id in VEG-223 routes)
    deck_id     INTEGER NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
    scryfall_id TEXT NOT NULL REFERENCES cards(scryfall_id)
                  ON UPDATE CASCADE ON DELETE RESTRICT,     -- printing FK; protect Tomes
    finish      TEXT NOT NULL DEFAULT 'nonfoil'
                  CHECK (finish IN ('nonfoil', 'foil', 'etched')),
    board       TEXT NOT NULL DEFAULT 'main'
                  CHECK (board IN ('main', 'sideboard', 'commander', 'companion', 'maybeboard')),
    quantity    INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
    CHECK (board NOT IN ('commander', 'companion') OR quantity = 1),
    UNIQUE (deck_id, scryfall_id, finish, board)                -- one slot per line; add to quantity
);

-- The UNIQUE index (deck_id first) backs per-Tome reads. This one backs the
-- cross-Tome reservation sum per folio (VEG-224), the RESTRICT check on card
-- deletes, and "which Tomes hold this card".
CREATE INDEX idx_deck_cards_scryfall_finish ON deck_cards (scryfall_id, finish);
