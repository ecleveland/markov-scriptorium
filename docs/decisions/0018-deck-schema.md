# 0018 — Deck Schema

**Status:** accepted (2026-10-02)

Resolves [VEG-222]. Defines the SQLite tables that hold Tomes (decks) and the
cards in them. Builds on [0001](0001-foundational-architecture.md) (SQLite,
per-printing granularity), [0004](0004-schema-migrations.md) (hand-rolled SQL
migrations), and [0009](0009-inventory-schema.md) (the `inventory` table that
deck slots are compared against). Ships as `backend/migrations/0006_decks.sql`.
ADR and migration numbers are separate sequences, so this is ADR 0018 and
migration 0006.

This ADR resolves the reserved-versus-referenced question that PROJECT.md and
CLAUDE.md left open. The answer is hybrid, default reserved. Each deck has a
`claims_cards` flag, 1 unless the user turns it off.

[VEG-222]: https://linear.app/vega-apps/issue/VEG-222
[VEG-223]: https://linear.app/vega-apps/issue/VEG-223
[VEG-224]: https://linear.app/vega-apps/issue/VEG-224

---

## Decision

Two tables. **`decks`** has one row per Tome:

- **`id`**: surrogate `INTEGER PRIMARY KEY`.
- **`name`**: `NOT NULL CHECK (trim(name) <> '')`. The create form needs a
  non-blank name anyway. SQLite's `trim()` strips only spaces, so the API trims
  all whitespace before the CHECK sees the value.
- **`format`**: nullable free text. By convention it holds a lowercase Scryfall
  `legalities` key (`commander`, `modern`, `predh`) or `cube` or `brew`, so a
  legality check is `json_extract(c.legalities, '$.' || d.format)`. The app
  lowercases, trims, and validates. NULL means a kitchen-table deck with no
  format.
- **`status`**: `CHECK (status IN ('in_progress','active','playtest','shelved'))`,
  default `in_progress`. The four values are ours and stable.
- **`claims_cards`**: `INTEGER NOT NULL DEFAULT 1 CHECK (claims_cards IN (0,1))`.
  1 means reserved (a sleeved deck holds its cards). 0 means referenced (a brew
  folder points at cards without holding them).
- **`notes`**, **`changelog`**: plain `TEXT` the user writes. PROJECT.md lists
  them as two things the user records, so they get the same shape.
- **`created_at`**, **`updated_at`**: `NOT NULL`, default
  `strftime('%Y-%m-%dT%H:%M:%SZ','now')`. Both must exist now, because
  `ALTER TABLE ADD COLUMN` rejects a non-constant default and a later column
  would be NULL for every existing deck.

**`deck_cards`** has one row per **slot**, a (deck, printing, finish, board)
line with a quantity:

- **`id`**: surrogate `INTEGER PRIMARY KEY`. It is the `:card_id` in
  [VEG-223]'s `/decks/:id/cards/:card_id` routes, matching `PATCH /inventory/:id`.
- **`deck_id`**: FK to `decks(id)`, `ON DELETE CASCADE`.
- **`scryfall_id`**: FK to `cards(scryfall_id)`, `ON UPDATE CASCADE ON DELETE
  RESTRICT`, the same actions as inventory.
- **`finish`**: `nonfoil`, `foil`, or `etched`, default `nonfoil`, the same
  domain as inventory.
- **`board`**: `main`, `sideboard`, `commander`, `companion`, or `maybeboard`,
  default `main`.
- **`quantity`**: `CHECK (quantity > 0)`, plus a table CHECK that commander and
  companion rows hold exactly one copy.
- `UNIQUE (deck_id, scryfall_id, finish, board)`: one slot per line. Adding
  another copy raises the quantity.

Index `idx_deck_cards_scryfall_finish (scryfall_id, finish)` backs the
cross-deck reservation sum per folio, the RESTRICT check when a card is deleted,
and "which Tomes hold this card". The UNIQUE index leads on `deck_id` and backs
per-Tome reads. `decks` gets no index because it will hold tens of rows.

**A slot references a printing, never an inventory lot.** A Tome says what it
wants and inventory says what is owned, so "owned vs needed" is a join. A card
the user does not own is an ordinary slot with no matching inventory.

**A slot is a printing plus a finish.** Owned copies match on
`(scryfall_id, finish)`, summed across condition, language, and location. A copy
owned in a different printing or finish shows as needed. The breakdown attaches
the `owned_across_printings` rollup to each needed slot as a swap hint, and a
PATCH on the slot's `scryfall_id` or `finish` makes the swap. When the swap
lands on a tuple the deck already holds, the UNIQUE constraint refuses it, so
[VEG-223] must either merge the quantities into the existing slot or answer
409. The same applies to adding a commander or companion that is already
slotted. The singleton CHECK rejects the quantity upsert, and the API must
turn that into a 409, not a 500. Exactly one commander per deck, and the
legality of a commander, are application validation.

**Commander and companion are boards, not deck columns.** They reserve and break
down like any other sleeved card. Partners and backgrounds are two `commander`
rows with different printings.

**Maybeboard rows never claim cards.** Every reservation and breakdown query
filters out `board = 'maybeboard'`, both for the deck's own demand and for what
other decks claim.

**Reservation is computed, never stored.** For a folio,
`available = MAX(0, owned - SUM(quantity))` over slots in decks with
`claims_cards = 1`, excluding maybeboard. It is one GROUP BY, the same answer
in every order, and needs no priority between decks. The per-deck breakdown
allocates the deck's own demand for a folio in a fixed order (commander,
companion, main, sideboard, then slot id) with a window function, so the same
folio in two boards is not counted twice. `test_schema_decks.py` pins that SQL
as the reference [VEG-223] lifts.

**No triggers.** The migration runner rejects any `BEGIN` token (ADR 0004), and
a trigger body needs `BEGIN ... END`. The schema supplies defaults. Everything a
trigger would do is application code.

---

## Alternatives Considered

- **An `any_printing` flag on slots.** A slot like "4 Lightning Bolt, any
  printing" would be satisfied by any owned printing. Rejected because
  availability becomes order-dependent. A pinned slot in one deck and an
  any-printing slot in another can both claim the same physical copy, and which
  one wins depends on which the allocator visits first. [VEG-224]'s "available
  vs total" then has no answer until an allocator runs over every claiming deck.
  Under printing-only slots it is a plain subtraction. Adding the flag later is
  an additive `ADD COLUMN`. The expensive part is the allocator, and no M4
  ticket asks for it.
- **`finish = 'any'`.** Rejected for the same order-dependence, one dimension
  smaller. With one foil copy, deck A wanting it in any finish, and deck B
  wanting it foil, whoever is counted first gets it. The cost is that a foil
  copy shows as needed for a nonfoil slot until the user flips the slot's
  finish.
- **A composite primary key on `(deck_id, scryfall_id, finish, board)`.**
  Rejected because a Scryfall id does not identify a slot, so [VEG-223]'s routes
  would need finish and board as query parameters on every PATCH and DELETE. A
  composite key on a rowid table builds a separate unique index anyway, so the
  surrogate costs nothing.
- **Commander columns on `decks`.** Rejected because they need a second FK and a
  second code path for reservation and breakdown, and leave no room for
  partners.
- **The changelog as a JSON array, or as two change-log tables of signed
  deltas.** Rejected because nothing in [VEG-223] through VEG-226 generates
  entries, and the editor treats the changelog as a text field. The tables
  would force every slot write to write history rows too, and a RESTRICT FK from
  history to `cards` would pin old printings against the catalog forever. If an
  auto-generated diff log is wanted later, a `deck_changes` table is additive.
- **A CHECK on `format`.** Rejected because Scryfall adds legality keys
  (`timeless` and `predh` arrived recently), and changing a CHECK in SQLite
  means rebuilding the table, which here is the parent of `deck_cards`.
- **`command` as the board name.** Rejected because PROJECT.md and the editor
  ticket say "commander". Only Oathbreaker's signature spell would be
  mislabelled, and no ticket asks for Oathbreaker.
- **No maybeboard, with a second Tome that has claims off holding the maybe
  pile instead.** Rejected. Adding a board value later means rebuilding
  `deck_cards`, so the maybeboard ships now.
- **No `updated_at`.** Rejected. Adding the column later would leave every
  existing deck NULL.

---

## Consequences

- Over-reservation is checked at write time in application code ([VEG-224]).
  The claimed sum plus the new quantity is compared to owned inside the write
  transaction, returning 409 when it would exceed. Selling a lot, or turning
  `claims_cards` on for a deck, can still leave a deck over-claimed. That is
  allowed and shows as needed, because refusing it would block the user from
  recording what is true.
- A deck with `claims_cards = 0` still sees other decks' claims subtracted from
  its available count, because availability is a property of the collection,
  not of the asking deck.
- Every reservation, availability, and breakdown query must exclude
  `board = 'maybeboard'`. Forgetting the filter makes a maybe card claim a copy.
- `updated_at` is only as fresh as the code that writes it. Every deck and slot
  write path in [VEG-223] must set it. A test per write path is the guard.
- The timestamp format is pinned to whole seconds in UTC with a `Z` suffix,
  the shape the column defaults produce. Application writes must produce the
  same shape (set it in SQL with `strftime('%Y-%m-%dT%H:%M:%SZ','now')`, or
  format a `datetime` to match), not Python's `isoformat()` output, which
  differs in shape. `refresh.py` stores `datetime.now(UTC).isoformat()`, which
  carries microseconds and `+00:00`. Two shapes in one column sort wrongly as
  strings, since `.` sorts before `Z` within the same second.
- [VEG-223]'s `:card_id` is the slot's `deck_cards.id`, not a Scryfall id.
- The bulk importer's `DELETE FROM cards` already fails against inventory's
  RESTRICT once one lot exists, and deck slots inherit the failure. The importer
  must upsert cards and delete only printings that left the export before
  [VEG-223] ships. A separate bug ticket owns that fix and the correction to
  ADR 0009's sentence about the refresh.
- `status` stores `in_progress` with an underscore, where PROJECT.md's prose
  says "in-progress". The API returns it as an enum value and the frontend maps
  it to a TypeScript union, so it stays identifier-safe. The UI shows its own
  label.
- Adding a board or status value is a table rebuild (create, copy, drop,
  rename), and for `decks` that includes its `deck_cards` children.
