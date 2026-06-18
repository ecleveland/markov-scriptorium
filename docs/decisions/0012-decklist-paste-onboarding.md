# 0012 — Decklist Paste Onboarding (parser + UI)

**Status:** accepted (2026-06-17)

Implements [VEG-414], the decklist-paste path of bulk onboarding (milestone
M3.5), on top of the format-agnostic resolution + atomic bulk-inscribe backend
from [0011](0011-bulk-onboarding-backend.md). No schema change.

[VEG-414]: https://linear.app/vega-apps/issue/VEG-414
[VEG-280]: https://linear.app/vega-apps/issue/VEG-280
[VEG-415]: https://linear.app/vega-apps/issue/VEG-415

---

## Decision

**1. The parser lives in the backend** (`scriptorium/onboarding/decklist.py`,
`parse_decklist(text) -> ParseResult`), exposed as `POST /onboarding/parse`
(text → `{entries, problems}`), which writes nothing. The frontend posts raw
text, then feeds the entries to the existing `/onboarding/resolve` and commits
via `/inventory/bulk`.

Rationale: 0011 deliberately made resolution *format-agnostic* so "the parsers
are the only format-specific code." A backend parser keeps that boundary, gets a
pytest suite (CLAUDE.md requires tests for this kind of data-model logic), and is
the shape the sibling CSV importer ([VEG-415]) will reuse. A frontend TS parser
was the runner-up — lower blast radius and live-as-you-type errors — but it
splits the parsing story across two languages and would leave CSV needing its
own parser.

**2. Parsing rules.** One card per line: `[<qty>[x]] <name> [ (<SET>)
[<collector>] ]`. `4`, `4x`, `4X`, `4 x` quantities; a bare name defaults to
qty 1. A collector number is only read alongside a set code, so a multiword
name's last word (`Krenko, Mob Boss`) isn't mistaken for one. Blank lines and
comment lines (a leading `#` or `//`) are skipped; an inline `#` note is stripped
but inline `//` is left intact (it is the split-card separator, `Fire // Ice`).
Section headers are a fixed allow-list (`Deck`, `Sideboard`, `Commander`,
`Companion`, `Maybeboard`, `Tokens`, trailing `:` tolerated), **not** "any line
without a quantity" — otherwise a qty-1 card named like a header would vanish.
Finish markers (`*F*`, `*E*`) are stripped. Every non-blank/comment/header line
yields exactly one entry **or** one problem — a line is never silently dropped.

**3. Front-face (MDFC) matching.** `catalog.printings_by_name` now also matches a
stored `"Front // Back"` card by its front-face name, because decklists write
`Delver of Secrets`, not `Delver of Secrets // Insectile Aberration`. This was
the candidate enhancement flagged in 0011's notes; the parsers landing made it
necessary, or real decklists would mass-`unmatched`. Front face only — the back
face is not a decklist reference.

**4. Ambiguous resolution reuses the resolve candidates, not a re-fetch.** A new
presentational `CandidatePicker` renders the candidate printings `/resolve`
already returned. The Inscribe flow's `PrintingPicker` was left untouched: it
re-queries the catalog by name, which would be a second round-trip and could
drift from what resolution matched.

**5. Finish/condition is a batch-wide selector** (default `nonfoil`/`NM`),
applied to every inscribed row. Decklists carry no finish/condition; a per-row
control is out of scope for a paste flow. No schema impact — the bulk endpoint
already takes per-row values.

## Alternatives

- **Frontend TS parser** — see (1); rejected for the format-agnostic + CSV-reuse
  reasons.
- **Fold parsing into `/onboarding/resolve`** — would make resolve
  format-specific and conflate parse errors (bad syntax) with resolution status
  (matched/ambiguous/unmatched). Kept separate.
- **Front-face matching as a later ticket** — rejected; without it the first
  real decklist looks broken.
- **Block the import until every ambiguous row is resolved** — instead we inscribe
  the chosen rows and report the rest as skipped, matching the ticket's "report,
  don't drop."

## Notes / follow-ups

- Back-face and `SB:`-prefixed lines aren't specially handled yet; they fall
  through to a problem or an unmatched row (reported, not dropped).
- The parse endpoint caps input at 1 MB of text; the entry count is bounded by
  the existing `MAX_BULK_ROWS` at resolve/commit.
