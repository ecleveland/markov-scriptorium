# 0031 The leaf layout

**Status:** accepted (2026-11-06)

Resolves part of [VEG-623]. Builds on [ADR 0017](0017-component-layer-convention.md),
whose `PageHeader` loses its eyebrow here, and on the ledger tokens from
[ADR 0030](0030-self-hosted-variable-fonts.md).

[VEG-623]: https://linear.app/cleveland-family-enterprises/issue/VEG-623

---

## Context

VEG-623 turns the app shell into a book. The nav becomes a running head in
small caps on one rule, and each page opens as a leaf with a narrow margin
column beside the text. The margin carries the page's folio mark ("fol. 2")
and its running title in small caps, both `aria-hidden`. Before this ticket
the running title sat above most page titles as the `PageHeader` eyebrow. The
Catalog had a raw `h1` with no eyebrow. On a Tome the eyebrow carried the
deck's format, which now shows as a Tag in the header and does not move to the
margin.

The old `.scriptorium` main capped itself at 36rem and centred its text. Every
page sheet also set its own `max-width`, from 40rem to 72rem. The Index was
72rem, the Catalog, the Tomes and the Archive 56rem, the importers 44rem, and
Inscribe, Scry and the specimen sheet 40rem. Those widths never rendered,
because the 36rem parent was narrower than all of them.

## Decision

**The leaf is a route-level wrapper.** A `Leaf` function inside `App.tsx`
renders the margin and then the page. Each route passes its folio and running
title, as in `element={<Leaf folio={2} running="The Catalog"><CatalogPage /></Leaf>}`.
Folios follow nav order, from the Index at 1 to the Muniment Room at 7.
Specimens has a running title and no folio. Pages know nothing about the
margin, and an unmatched route still renders an empty main.

**Two columns, centred as a pair.** `.scriptorium` is a grid with a 5.5rem
margin column (`--leaf-margin`) and a text column of `--leaf-measure`, 66ch by
default. The margin text is right-aligned against the gap.

**A page widens from its own sheet.** A page that needs more than 66ch sets
the property on its parent with `:has()` in its own stylesheet.
`index/index.css` sets 72rem for the Index grid, and `catalog/catalog.css`
sets 56rem for the Catalog table and the folio view. The page sheets only set
`--leaf-measure`. `App.css` declares and reads it, so the contract test's
undeclared-reference check holds. Everything else reads at 66ch.

**One column at 44rem and below.** The query is written `@media (max-width: 44rem)`.
Media query rems resolve against the browser default of 16px, not the 19px
root, so the break is 704px. At 704px and below the margin is hidden and the
text takes the whole width.

**The 36rem cap is gone,** along with the per-page `max-width`, `margin: 0
auto` and `text-align: left` lines that fought it. The `max-width` and
`margin: 0 auto` lines had never rendered. The `text-align: left` lines only
undid the parent's centring, so removing them together with that centring
changes nothing a reader saw.

**Bring in is a page.** `/import` renders a short page with two entries, the
decklist import and the CSV import, each a link and one line explaining it.
The nav's "Bring in" link stays current on both children through
react-router's prefix match.

**The status chip becomes a sentence** read from `/api/health` alone.

| Health answer | Sentence | `data-state` |
| --- | --- | --- |
| Still waiting | consulting the catalog… | `pending` |
| 2xx with `database: "ok"` | the catalog is open | `ok` |
| 2xx with any other `database` | the catalog could not be opened | `error` |
| Fetch failed, not 2xx, or not JSON | the catalog could not be reached | `error` |

Before this ticket a 200 with the database unavailable showed `ok`. That was
a bug, and the third row fixes it.

**The title takes one word in rubric.** `.rubric` is a classes-only rule in
`components.css`. Callers wrap one word of a display title in it, as in
`The <span className="rubric">Index</span>`. It is for display sizes only, because the
red does not reach body-text contrast at reading sizes.

## Alternatives

- **A shell route table with `matchPath`.** The shell would look up the
  current path in a table to find the folio and running title. That keeps a
  second copy of the route list that can drift from the `<Routes>` block. The
  wrapper puts the margin data on the route itself.
- **`PageHeader` positions its own margin.** Every page already renders a
  `PageHeader` or a raw `h1`, so the margin could hang off it. That puts layout
  for the whole leaf inside one component, misses the Catalog's raw `h1`s, and
  makes the folio a prop on every page instead of on every route.
- **A fixed 66ch for every page.** The Index grid and the Catalog table do not
  fit in 66ch at the 19px root. They would wrap or scroll sideways.
- **A `<details>` disclosure for Bring in.** A menu in the running head would
  save a page, but it hides the two imports behind a click, needs its own
  focus and close handling, and leaves nothing for the nav link to mark as
  current.

## Notes

- A browser without `:has()` falls back to 66ch for the Index and the
  Catalog. The pages still render, only narrower.
- The folio and the running title are `aria-hidden`, so the accessible name
  of each page is still its `h1`.
