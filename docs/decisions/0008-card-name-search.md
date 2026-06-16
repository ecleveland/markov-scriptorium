# 0008 — Card Name Search (FTS5 Trigram)

**Status:** accepted (2026-06-16)

Resolves [VEG-215]. Decides how the local card catalog is exposed for reads —
by-ID lookup, name search, and autocomplete — and specifically how name search
is indexed. Ships as `scriptorium/catalog.py` (query layer),
`scriptorium/api/cards.py` (router), and migration `0004`.

[VEG-215]: https://linear.app/vega-apps/issue/VEG-215

---

## Decision

**Endpoints** (`/cards`, first `APIRouter`, mounted in `main.py`):

- `GET /cards/{scryfall_id}` — one printing with its `card_faces`; `404` if absent.
- `GET /cards/search?q=&limit=&offset=` — `{results, total, limit, offset}`;
  results are full printing rows (no faces), `total` is the unpaginated count.
- `GET /cards/autocomplete?q=&limit=` — `{names: [...]}`, distinct names for
  type-ahead.

All reads come from the local SQLite catalog (CLAUDE.md: never live Scryfall).
The query layer deserializes the JSON-text columns the importer stores verbatim
(`colors`, `legalities`, `image_uris`, …) back into real JSON at the edge.

**Name search uses an FTS5 trigram index** (`cards_fts`, migration 0004) for
substring/fuzzy matching without the leading-wildcard table scan a plain
`LIKE '%q%'` forces:

- **External content** (`content='cards'`, `content_rowid='rowid'`): the index
  stores no copy of the name, reading it from `cards` via the shared rowid.
- **Rebuilt by the importer, not triggers.** After each full-replace load the
  importer runs `INSERT INTO cards_fts(cards_fts) VALUES('rebuild')` (wrapped as
  `catalog.rebuild_name_index`) inside its existing transaction, so the index is
  always atomically consistent with `cards`. Triggers were rejected: they'd fire
  ~110k times per refresh, and the migration runner forbids the `BEGIN/END`
  trigger body (its transaction-control guard, ADR 0004).
- **<3-character fallback.** The trigram tokenizer can't tokenize terms shorter
  than 3 characters, so those queries fall back to a `LIKE` that rides the
  existing `idx_cards_name` NOCASE index — prefix (`q%`) for autocomplete,
  substring (`%q%`) for search.
- User terms are wrapped as an FTS5 quoted string so punctuation in card names
  ("Yawgmoth's Will", "Borrowing 100,000 Arrows") and FTS operators can't break
  the `MATCH` query.

---

## Alternatives Considered

- **Plain `LIKE '%q%'`** — rejected for search. Simple and dependency-free, but a
  leading-wildcard scan over ~110k rows on every keystroke-driven autocomplete is
  the wrong default. Kept only as the sub-3-character fallback, where the term is
  too short to index anyway.
- **FTS5 with sync triggers** — rejected. The canonical external-content pattern,
  and it keeps the index correct for *any* writer, but per-row triggers on a
  full-replace import are far more work than one rebuild, and the runner rejects
  the `BEGIN/END` body regardless. Revisit if a second, incremental writer to
  `cards` appears.
- **`spellfix1` / edit-distance fuzzy** — deferred. True typo tolerance needs the
  `spellfix1` extension (not bundled — a new dependency) or a custom ranker.
  Trigram substring matching covers the practical "I typed part of the name" case
  without one.
- **Standard `unicode61` tokenizer** — rejected. Word/prefix matching only; it
  wouldn't match a substring inside a word, which is the common autocomplete case.

---

## Consequences

- **The importer now depends on `catalog.rebuild_name_index`** and on `cards_fts`
  existing — fine, since migrations always run before import. A direct writer to
  `cards` that bypasses the importer must call `rebuild_name_index` (or the index
  goes stale); today only the importer writes `cards`.
- **Rebuild adds time to each import** (one pass over the names). Acceptable for a
  daily background refresh; if it ever isn't, an incremental scheme is the pivot.
- **Requires SQLite built with FTS5 + the trigram tokenizer** (SQLite ≥ 3.34).
  CPython's bundled SQLite has both (verified on 3.53.1); flagged so a stripped
  build would fail loudly at migration time rather than silently.
- Search relevance is FTS `rank` for trigram queries and name order for the LIKE
  fallback — good enough for MVP; tunable later without an API change.
