# 0011 — Bulk Onboarding Backend (resolution + atomic bulk inscribe)

**Status:** accepted (2026-06-17)

Resolves the shared-backend slice of [VEG-280] (bulk collection onboarding,
milestone M3.5). The format-specific parsers/UIs — decklist paste ([VEG-414])
and CSV import ([VEG-415]) — build on this. Reuses the [0009](0009-inventory-schema.md)
inventory schema and the VEG-218 write path; no schema change.

[VEG-280]: https://linear.app/vega-apps/issue/VEG-280
[VEG-414]: https://linear.app/vega-apps/issue/VEG-414
[VEG-415]: https://linear.app/vega-apps/issue/VEG-415

---

## Decision

Two backend pieces, both format-agnostic so decklist and CSV share them.

**1. Resolution service** (`scriptorium/onboarding/resolution.py`). A raw import
entry — a card `name`, optionally pinned by `set_code` / `collector_number`,
plus quantity/finish/condition/language — resolves against the local catalog to
one of three statuses:

- **matched** — exactly one printing; the printing is returned, ready to inscribe.
- **ambiguous** — several printings (a name reprinted across sets) with no pin
  narrowing it to one; the candidate printings are returned for the user to pick.
- **unmatched** — no printing in the catalog.

Matching is **exact name** (case-insensitive), not the fuzzy trigram search —
an import line names a specific card. Lookup is the new
`catalog.printings_by_name`, ordered oldest-first for a stable candidate list.
Resolution is read-only; the result echoes the input back for the preview.
Exposed as `POST /onboarding/resolve` (entries → per-entry status + a count
summary), which **writes nothing**.

**2. Atomic bulk inscribe** — `POST /inventory/bulk` and
`inventory.create_lots`. Resolved rows (the same shape as a single inscribe)
are written in **one transaction, all-or-nothing**: every row's printing is
validated up front in a single batched query (`existing_printing_ids`), and if
any is unknown the batch is rejected `422` with the offending rows; otherwise
all rows insert and commit together. A failure mid-insert rolls the whole batch
back, so an import never lands a partial collection.

## Alternatives

- **Reuse per-row `POST /inventory`, loop on the client.** No backend change,
  but a thousands-of-card import is thousands of round-trips and transactions,
  and a mid-batch failure leaves a half-imported collection with no clean
  rollback. Rejected for the bulk use case.
- **Fuzzy name matching in resolution.** The catalog already has trigram search,
  but using it here would surface near-miss printings as false "matches"; an
  import line should resolve to the card it names or be reported, not guessed.
  Fuzzy "did you mean" can be a later enhancement on the unmatched set.
- **Partial bulk insert (skip bad rows, report them).** Simpler error story for
  the user, but it makes the commit non-atomic and the preview step already
  exists to catch bad rows before commit. All-or-nothing keeps the invariant
  that a successful bulk call wrote exactly what was previewed.
- **Resolve + inscribe in one endpoint.** Conflates the preview (which the UI
  needs in order to let the user disambiguate) with the commit. Kept separate.

## Reasoning

The preview/commit split mirrors the real flow: parse → resolve → disambiguate →
commit. Keeping resolution read-only and format-agnostic means both decklist and
CSV feed the same service and the same atomic write, with the parsers being the
only format-specific code. Atomicity matches a local-first tool where a botched
import should leave the catalog exactly as it was.

## Notes / follow-ups

- Exact-name matching means a multi-faced card referenced by only its front-face
  name (`Delver of Secrets` vs the stored `Delver of Secrets // Insectile
  Aberration`) resolves as **unmatched**. Acceptable for now; front-face / oracle
  matching is a candidate enhancement when the parsers land.
- `existing_printing_ids` chunks its `IN (…)` query under SQLite's per-statement
  parameter limit; the batch itself is capped at 10 000 rows per request.
