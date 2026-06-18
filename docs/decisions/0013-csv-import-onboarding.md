# 0013 — CSV Import Onboarding (Manabox / Deckbox / Archidekt)

**Status:** accepted (2026-06-18)

Implements [VEG-415], the CSV-import path of bulk onboarding (milestone M3.5),
on top of the shared resolve + atomic bulk-inscribe backend
([0011](0011-bulk-onboarding-backend.md)) and the parser-then-shared-resolve
pattern established by decklist paste ([0012](0012-decklist-paste-onboarding.md)).
No schema/migration change.

[VEG-415]: https://linear.app/vega-apps/issue/VEG-415
[VEG-280]: https://linear.app/vega-apps/issue/VEG-280

---

## Decision

**1. A second parser, same pipe.** `scriptorium/onboarding/csv_import.py`
(`parse_csv(text, declared_format=None) -> CsvParseResult`) detects the source
from the header row, maps its columns into the shared resolver shape, and
normalizes finish/condition vocab into the catalog enums. Exposed as
`POST /onboarding/parse-csv` (writes nothing); the unchanged `/onboarding/resolve`
and `/inventory/bulk` handle everything after. Like the decklist parser it is
pure text — no catalog access.

**2. Format detection by header signature, user-overridable.** Each source has a
disjoint set of distinctive columns (Manabox `scryfall id + set code + foil`,
Archidekt `scryfall id + edition code + finish`, Deckbox `count + edition + card
number`). An unrecognized header with no `format` override is a 422 carrying the
observed headers and the supported sources, so the UI prompts for an explicit
choice. A declared `format` skips detection but is still validated against its signature
columns — forcing a format the file doesn't structurally match is rejected
(otherwise an absent Finish column would silently read as non-foil).

**3. Per-source normalization; an unmappable value is a row problem.** Finish and
condition map per source into `{nonfoil,foil,etched}` / `{NM,LP,MP,HP,DMG}`; a
blank Foil column is a real non-foil mapping, but an *unrecognized* finish or
condition makes the row a reported problem rather than a guessed default —
provenance is never invented (the user chose this over defaulting to NM/nonfoil).
Language display names normalize to short codes (`English`→`en`), unknowns pass
through. Every data row yields exactly one entry or one problem; nothing is
dropped.

**4. Identifier-first resolution — extends the VEG-280 resolver.** CSV exports
carry precise pins a name-only path would waste, so `RawEntry` (and `RawEntryIn`)
gain two optional fields:
- `scryfall_id` — Manabox/Archidekt rows carry it. `resolve_entry` short-circuits
  to the exact printing via `catalog.get_card` (with `card_faces` stripped so the
  match matches the name-path shape). A stale/foreign ID absent from the catalog
  falls through to the name match rather than sinking a resolvable row.
- `set_name` — Deckbox names the edition (e.g. "Modern Horizons 2"), not a code.
  When no `set_code` is given, `resolve_entry` filters the name's printings by
  `set_name` in Python over the rows `printings_by_name` already returns — no new
  SQL, mirroring how `set_code`/`collector_number` filter today. Precedence:
  `scryfall_id` > `set_code` > `set_name`, then `collector_number`.

This extends the format-agnostic resolution contract 0011/0012 froze; it is
backward-compatible (both fields default `None`, the decklist flow is unchanged)
and was confirmed before building.

**5. Per-row finish/condition in the UI, no batch selector.** Unlike the decklist
page (where the user picks one finish/condition for the whole import), CSV rows
carry their own, so `CsvImportPage` drops the batch selector and inscribes each
row with its own normalized values. The page adds **file upload** (+ a paste
fallback) and a format-detect/override selector; it reuses `CandidatePicker`, the
`PreviewRow` discriminated union, and the problems panel unchanged.

## Alternatives

- **Frontend CSV parsing** — rejected for the same reasons as decklist (0012):
  keeps parsing in one tested Python place and reuses the shared resolve pipe.
- **Ignore the Scryfall ID, resolve by name+set+collector** — simpler, no resolver
  change, but demonstrably more ambiguous/unmatched rows on real exports. Rejected.
- **Resolve the CSV's Scryfall ID straight into `/inventory/bulk`** — bypasses the
  preview's per-row `CardPrinting` display and the graceful name fallback. Routing
  through resolution keeps one contract and validates per-row.
- **Default an unrecognized condition to NM** — rejected; silently downgrading
  provenance is worse than a visible, fixable row problem.
- **Deckbox edition-name→set-code lookup in the parser** — would make the parser
  catalog-aware. Rejected in favor of filtering by `set_name` in the resolver,
  keeping the parser pure.

## Notes / follow-ups

- `row_number` is the logical data-row index (blank lines skipped), not the
  physical spreadsheet line — the number shown in a problem matches the parsed
  stream.
- `PARSE_MAX_CHARS` (1 MB) and `MAX_BULK_ROWS` (10 000) still bound a single
  import; a very large collection may need chunking — deferred.
- Back-face MDFC names and non-`en` catalog data remain out of scope (the catalog
  is English-only; language is informational).
