# 0009 — Inventory Schema

**Status:** accepted (2026-06-16)

Resolves [VEG-217]. Defines the SQLite table that holds the owned card
inventory — what the user physically owns, keyed to Scryfall printings. Builds
on [0001](0001-foundational-architecture.md) (SQLite, per-printing granularity),
[0004](0004-schema-migrations.md) (hand-rolled SQL migrations), and
[0005](0005-scryfall-card-schema.md) (the `cards` catalog this references).
Ships as `backend/migrations/0005_inventory.sql`.

[VEG-217]: https://linear.app/vega-apps/issue/VEG-217
[VEG-279]: https://linear.app/vega-apps/issue/VEG-279

---

## Decision

One table, **`inventory`**, with one row per **acquisition lot** of an owned
printing:

- **`id`** — surrogate `INTEGER PRIMARY KEY`. A row is a lot, not a unique folio.
- **`scryfall_id`** — `NOT NULL` FK into `cards(scryfall_id)`, the per-printing
  canonical key. Same card in two sets = two printings = two records, for free.
- **`quantity`** — `NOT NULL DEFAULT 1 CHECK (quantity > 0)`.
- **`finish`** — `CHECK (finish IN ('nonfoil','foil','etched'))`, Scryfall's
  vocabulary. Keeps foil and non-foil of one printing as **separate rows**.
- **`condition`** — `CHECK (condition IN ('NM','LP','MP','HP','DMG'))`.
- **`language`** — `NOT NULL DEFAULT 'en'` (see below).
- **`location`** — free-text `TEXT`, nullable (see below).
- **`acquired_at`**, **`price_paid`** — optional; ISO date and decimal string.
- **`notes`** — optional `TEXT`.
- **`tags`** — optional JSON array `TEXT`, matching the `cards` JSON convention.

Index `idx_inventory_scryfall_id` backs "ownership of this printing" lookups and
the folio rollup.

**Lot rows, not unique folio stacks.** There is deliberately **no** unique
constraint on `(scryfall_id, finish, condition, language, location)`. Each row is
one acquisition with its own `acquired_at` / `price_paid`, so buying the same
folio twice preserves a distinct cost basis for value tracking. Total owned of a
folio is `SUM(quantity)` grouped by the printing/finish/condition/language tuple.

**FK restricts, not cascades.** `ON DELETE RESTRICT` (with `ON UPDATE CASCADE`)
— the deliberate opposite of `card_faces`' cascade. The card catalog is
full-replaced on every bulk Scryfall refresh; owned inventory must never be
deleted out from under the user by that churn or a stray card delete. A printing
that has owned copies cannot be deleted until those copies are removed first.

**`location` is free text, for now.** [VEG-279] owns the decision of whether a
**Volume** is free text or a managed entity, and explicitly anticipates
migrating this column to an FK. This schema ships the text column; that ticket
promotes it.

**Separate `language` column** even though each Scryfall printing is
language-specific. The local catalog loads only `default_cards` (English), so a
Japanese copy still FKs to the English printing row while recording its actual
language here.

---

## Alternatives Considered

- **Unique folio stacks** (`UNIQUE(scryfall_id, finish, condition, language,
  location)`, quantity aggregates, `ON CONFLICT` upserts) — rejected. Cleaner
  upserts, but `acquired_at` / `price_paid` collapse to last-write and lose
  per-purchase cost basis, undercutting the PROJECT value-tracking goal. The lot
  model keeps that history; the rollup query recovers the aggregate view.
- **`location` as an FK to a `volumes` table now** — deferred to [VEG-279] by
  design, which flags it as a data-model decision needing its own sign-off.
- **`CASCADE` on the card FK** (mirroring `card_faces`) — rejected as dangerous:
  it would let a bulk refresh or an errant delete wipe owned inventory.
- **Spawning duplicate rows per physical copy** instead of `quantity` —
  rejected; quantity is in the ticket and avoids row bloat for playsets.
- **`condition` / `finish` as free text** — rejected; the domains are small,
  stable, and well-known, so CHECK constraints catch typos cheaply.
- **`price_paid` as REAL/INTEGER cents** — kept as TEXT to match the existing
  `cards.price_*` columns and avoid float rounding; aggregation casts as needed.

---

## Consequences

- "How many do I own?" is a `SUM(quantity)` grouped query, not a single-row
  read. UI/API code (the Inscribe flow, search) owns that rollup.
- A printing with inventory can't be deleted until its rows are cleared; sync
  code that prunes the catalog must account for the RESTRICT (in practice the
  bulk refresh replaces rows it still has, so live printings are unaffected).
- [VEG-279] will add a `volumes` table and migrate `location` from text to an
  FK; until then, free-text location values can drift (the motivation for that
  ticket).
- Bookkeeping columns (e.g. `created_at`) are intentionally absent — they arrive
  with the write path as an additive migration if needed.
- Quantity-zero rows are impossible by CHECK; removing the last copy means
  deleting the row, not setting `quantity = 0`.
