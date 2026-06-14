# 0005 — Scryfall Card Data Schema

**Status:** accepted (2026-06-14)

Resolves [VEG-211]. Defines the SQLite tables that hold the local Scryfall card
catalog. Builds on [0001](0001-foundational-architecture.md) (SQLite, per-printing
granularity) and [0004](0004-schema-migrations.md) (hand-rolled SQL migrations).
Ships as `backend/migrations/0002_scryfall_cards.sql`.

[VEG-211]: https://linear.app/vega-apps/issue/VEG-211

---

## Decision

Two tables model Scryfall's printing data:

- **`cards`** — one row per **printing**, keyed by the Scryfall `id`
  (`scryfall_id`), the canonical foreign key per CLAUDE.md. Carries the fields
  the MVP reads: identity (`oracle_id`, `name`, `set_code`, `collector_number`,
  `rarity`, `lang`, `released_at`, `layout`), gameplay text (`mana_cost`, `cmc`,
  `type_line`, `oracle_text`, `colors`, `color_identity`), `finishes`, a
  price snapshot, `legalities`, `image_uris`, and `scryfall_uri`.
- **`card_faces`** — child rows for multi-faced layouts (transform, modal_dfc,
  split, flip, adventure), keyed by `(scryfall_id, face_index)` with a
  `REFERENCES cards(scryfall_id) ON DELETE CASCADE`. Single-faced cards have
  zero face rows and carry everything on the `cards` row.

**Store-vs-derive choices:**

- **Prices** → individual nullable TEXT columns (`price_usd`, `price_usd_foil`,
  `price_usd_etched`, `price_eur`, `price_eur_foil`, `price_tix`). A snapshot,
  overwritten wholesale on each bulk refresh. Discrete columns make later
  collection-value `SUM()`s straightforward.
- **`colors` / `color_identity` / `finishes` / `legalities` / `image_uris`** →
  stored as JSON text verbatim from Scryfall. None are MVP query targets that
  justify normalization; keeping them as JSON stays faithful to the source and
  avoids join tables in a single-user local catalog.
- **`set` → `set_code`**: renamed to avoid the SQL reserved word.
- **`collector_number`** is TEXT — it can hold `★`, letters, and other
  non-numeric forms.

**Indexes:** `idx_cards_name` (`name COLLATE NOCASE`, backs local
case-insensitive autocomplete), `idx_cards_oracle_id` (ownership across
printings), `idx_cards_set_code`, `idx_cards_set_collector`
(`set_code, collector_number`, scanner disambiguation), and
`idx_card_faces_name`.

**Foreign-key enforcement** is now turned on per-connection
(`PRAGMA foreign_keys = ON` in `db.connect()`). ADR 0004 deferred this to "when
FK schemas land"; `card_faces → cards` is the first such schema, so it lands here.

---

## Alternatives Considered

- **Single wide `cards` table with face columns inlined** (`name_back`,
  `oracle_text_back`, …) — rejected. Sprawls nullable columns, caps faces at a
  fixed count, and forces `//`-parsing of the combined name. A child table is
  cleaner and open-ended.
- **Normalizing colors into a `card_colors` join table** — rejected as overkill
  for one local user; color filters run fine as JSON/`LIKE` over ~100k rows.
- **Single JSON `prices` blob** — rejected in favor of discrete columns for
  easier aggregation; the key set is small and stable.
- **FTS5 full-text search over oracle text** — deferred. The NOCASE name index
  covers MVP prefix search; add FTS if oracle-text search becomes a feature.

---

## Consequences

- Multi-faced cards require a two-step write (card row + face rows); the sync
  importer ([VEG-211]'s downstream load ticket) owns that and the JSON
  serialization of the blob columns.
- Prices reflect only the latest bulk load. **Price history** (a
  `price_snapshots` table) remains a future ticket per the PROJECT wishlist.
- Bookkeeping columns (e.g. our own `imported_at`) are intentionally absent —
  they belong with the sync code that writes them, as an additive migration.
- Rich Scryfall fields not yet needed (e.g. `keywords`, rulings) are omitted;
  each is a cheap additive migration when a feature needs it.
- FK enforcement is now global to every `db.connect()` caller — intended, but
  worth remembering when writing future schemas with foreign keys.
