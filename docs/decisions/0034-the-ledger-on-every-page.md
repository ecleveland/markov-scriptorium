# 0034 The ledger on every page

**Status:** accepted (2026-11-16)

Resolves part of [VEG-625]. Builds on [ADR 0033](0033-the-ledger-and-the-lit-plate.md)
and on [ADR 0017](0017-component-layer-convention.md), whose vocabulary table
gains the `Seek` row and changes the `PrintingChip`, `Ledger` and `Tag` rows.

[VEG-625]: https://linear.app/cleveland-family-enterprises/issue/VEG-625

---

## Context

VEG-624 gave the Index and the Catalog the ledger, the plate and the prose
helpers. The Tomes, Inscribe, the two importers and the Muniment Room still
used panels, status pills, headings such as "Main · 4", a table of sealed
copies, and strings such as "4× Sol Ring (C21 #263) · nonfoil".

The ticket's done-when forbids any middle dot, uppercase transform, mono token
or arrow in `src/`. Meeting it meant rewriting copy as well as styles, so the
printing strings, the session list and the import counts changed with the
layout.

Many small choices came up along the way. This record lists them in one place
so the next page that adopts the ledger starts from the same answers.

## Decision

- **`describePrinting()` reads "Limited Edition Alpha (LEA), no. 161".** The
  set code stays because the pickers tell printings apart by it. The `#` and
  the middle dot are gone.
- **The shelf of spines is page-local to Tomes.** `.shelf` and `.spine` live
  in `tomes.css` and are not a component, because only the Tomes page uses
  them. They move to the layer if the Index gets a Volumes shelf. `spineEdge()`
  picks the edge colour and the page sets it with `data-edge`. Gold marks an
  active Tome, which is the ticket's "complete". Moss marks the format
  "cube", the one format that names a list rather than a deck. Oxblood marks
  everything else.
- **Board headings are `.opening` h3s, and the copy count sits beside them as
  a gold figure.** `BoardHead` renders both. The heading names a region, so it
  reads "Main", not "Main · 4".
- **`LedgerEntry` gained an `aside` slot.** It is a full-width line under the
  row, for the importers' candidate picker and the breakdown's swap hint.
  Neither fits in the four cells of an entry.
- **The running number continues across boards.** `boardOffsets` gives each
  board the count of rows before it, in the editor and in the breakdown. The
  Index already continues its number across pages.
- **The breakdown's two-column tally became a gold figure over a note.** The
  figure is what is in hand. The note says what is still needed, "in hand" or
  "in hand, 2 needed". The totals are one sentence from `tallySentence`.
- **The seek field moved from `index.css` to `components.css`.** It is `.seek`,
  `.seek__lead` and `.seek__input`, classes only. `CardSearch` uses it with
  the input named "Card name", the name the Tomes page and the E2E specs
  already use.
- **Inscribe's form sits inside the `Plate`.** The fields are among its lines.
  The seal button and "Change printing" are its actions.
- **Session entries read as a sentence.** `describeEntry()` returns "One copy
  of Sol Ring, C21 no. 263, nonfoil."
- **Importer preview rows are ledger entries.** The status word, from
  `RowStatusTag`, comes first in the name cell. The coloured left border is
  gone. The counts notice became `importSummary()`. A CSV row's finish and
  condition are words on the where line in every state.
- **Panels gave way to rule-bounded sections opened by `.opening` headings.**
  These are Bind a new Tome, Add a card, Inscribed this session, Unreadable
  lines and rows, Sealed copies, and Carry the collection elsewhere.
- **The Muniment Room's table is a `Ledger` named "Sealed copies".** Its thumb
  is the `Seal`. The exports are two sentences with links.
- **`.tag` is upright and `.ledger__note` sets old-style figures.** Both came
  up while laying ledgers on these pages. A tag inside an italic where line
  had slanted, and a note's figures did not match the gold figure above it.
- **`×` stays before a quantity that leads a name.** That covers the breakdown
  lines and "Added 1× Sol Ring". The done-when does not name it, and the Index
  tile already counts that way.

## Consequences

- The done-when grep is clean except for two hits that are not copy. Two
  contract tests assert that `--font-mono` is not declared, and the type-line
  split in `tomes/sort.ts` cuts on Scryfall's own dash.
- The E2E specs for tomes, inscribe, archive, index, scan and visual were
  updated for the new copy.
- A board's heading no longer carries its count, so tests select boards by
  name alone.
