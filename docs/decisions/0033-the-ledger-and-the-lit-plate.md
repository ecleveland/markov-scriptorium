# 0033 The ledger and the lit plate

**Status:** accepted (2026-11-12)

Resolves part of [VEG-624]. Builds on [ADR 0017](0017-component-layer-convention.md),
which gains the `Ledger`, `Plate` and `FinishWord` rows, and on the leaf from
[ADR 0031](0031-the-leaf-layout.md).

[VEG-624]: https://linear.app/cleveland-family-enterprises/issue/VEG-624

---

## Context

The Index and the Catalog listed folios and lots in tables: seven and six
columns under small-caps headers, a hover fill on every row, and a "Showing 1
to 24 of 87 folios" line above. The mockup for M5.5 sets them as a ledger
instead. Each entry carries a rubric number, a thumb, the name in the display
face, one italic line for the printing and the shelf, and the count in gold.
The Index opens on a sentence about the whole collection and on the newest
inscription, shown large on a lit plate.

Three questions had more than one answer.

1. Where the ledger and the plate live. The Index, the Catalog, the printing
   page and the lot page all need them.
2. Where the plate's newest inscription comes from.
3. How the opening sentence sets its numbers. The ticket's rule says words
   under one hundred and figures above, while its example spells out "Three
   hundred and twelve".

## Decision

- **The ledger and the plate are components.** `Ledger`, `LedgerEntry`,
  `LedgerFigure`, `Plate` and `FinishWord` sit in `src/components/` with their
  classes in `components.css`. A page passes the thumb, the name, the italic
  line and the count as nodes. The Catalog's entry passes its quantity
  stepper as the count, and the Index's passes a gold figure.
- **One glow.** `--plate-glow` in `tokens.css` is a radial gradient mixed from
  the gold. Only the `.plate` rule reads it, and `components.test.ts` fails
  if any other rule does. The no-art placeholder is a dark plate built from
  existing tokens, with no glow of its own.
- **The plate reads the newest lot.** It asks `GET /inventory?limit=1`, which
  is newest first by id, under its own query key. It does not take the first
  row of the Index search, because that row is only the newest under the
  default sort. The plate shows on the unfiltered first page only.
- **Numbers follow the rule, not the example.** `numberWords` in
  `catalog/prose.ts` spells 0 to 99 and sets 100 and up in figures. "312
  folios, kept in nine Volumes." is the result.
- **The running number continues across pages.** An entry's number is the
  response's own offset plus its place on the page, so page two of the Index
  starts at 25 and page two of the Catalog at 26.
- **The counts come from existing endpoints.** The folio total is the search
  total, the Volumes are the facets' locations and the Tomes are `GET /decks`.
  No new endpoint.

## Consequences

- The tables, their scroll wrappers and their row hover rules are gone. A
  ledger entry is a grid row in an ordered list, and nothing in the ledger
  fills on hover. `components.test.ts` holds that.
- `LotRow` is a ledger entry now, so the printing page lists its lots as a
  short ledger inside the same named region.
- The pager reads "Earlier folios" and "Later folios" as ghost buttons, and
  only renders when there is a second page.
- Sorting and the view switch became small-caps text buttons with
  `aria-pressed`, so the Sort select is gone.
- The plate has no inscription date. The API has no inscription timestamp,
  and `acquired_at` is what the user typed.
