# 0016 — Inventory Browse Surface and Server-State Caching

**Status:** accepted (2026-08-23)

Decided while building the Catalog list and folio detail views ([VEG-220]), the
first screens that *read* the inventory back out. Until this ticket the app had
three ways to put cards in (Inscribe, decklist paste, CSV import) and none to
look at them. Builds on [0009](0009-inventory-schema.md) (the lot model) and
[0010](0010-frontend-testing-and-routing.md) (React Query deferred, routing).

[VEG-220]: https://linear.app/vega-apps/issue/VEG-220

---

## Decision

**Server state moves to TanStack Query v5.** ADR 0010 deferred it with an
explicit trigger: "revisit when shared cached lists appear." This is that
moment. A single `QueryClient` lives in `main.tsx`; query keys nest under
`inventoryKeys.all` in `src/catalog/queryKeys.ts`, so one invalidation after a
write refreshes the list, the open folio, and any ownership summary at once.
Defaults are `retry: 1` and `refetchOnWindowFocus: false`, since this is a
single-user local app and returning to the tab is not evidence the catalog
changed. Tests get a fresh client per case through `renderWithQuery`.

The existing pages (Inscribe, the two importers) keep their plain `fetch` calls.
They are one-shot writes with no cache to keep coherent, so migrating them would
be churn.

**The browse view is the Catalog, at `/catalog`.** It also becomes the app's
landing route, replacing the redirect to `/inscribe`. It lists lots newest
first, paginated, with no search or filters: those are The Index (M5, VEG-227
and VEG-228), which will build on this rather than replace it. Two names for one
screen would be worse than leaving the themed one unspent.

**Cross-printing ownership rides on the existing endpoint.**
`GET /inventory/card/{scryfall_id}` gains an `across_printings` block beside its
per-folio `rollup`, so the detail view answers "how many of this card do I own
anywhere" in the same request. Printings are grouped by Scryfall's `oracle_id`,
falling back to the card name when the catalog row has none. The fallback is not
optional: `WHERE oracle_id = NULL` matches nothing in SQLite, so without it an
un-oracled card would silently report only its own printing, and grouping the
NULLs together would merge unrelated cards into one total.

**Removal is a two-step inline confirm, not `window.confirm`.** A native modal
blocks the Playwright harness and the browser-automation tooling from
[0015](0015-e2e-playwright.md), cannot be styled, and cannot be asserted on.

## Alternatives

- **Keep plain `fetch` plus a `useInventoryList` hook.** Viable for two views.
  Rejected because the invalidation this ticket needs (a quantity stepped in the
  list, a folio amended on the detail page, both reflected everywhere) is
  precisely the hand-rolled cache 0010 wanted to avoid, and M5 adds filters on
  top of it.
- **SWR instead of TanStack Query.** Smaller, but its mutation and invalidation
  story is thinner, and TanStack Query is the better-documented default for the
  optimistic-update work M4's deck editor will want.
- **A separate `GET /inventory/oracle/{oracle_id}` rollup.** Cleaner separation
  and reusable from a future card page. Rejected for now: the detail view would
  need two round trips, and the inventory response does not carry `oracle_id` for
  it to ask with. Worth revisiting when a card-centric page exists.
- **Group printings by name only.** Simpler, and it works for the dev seed. Wrong
  for the real catalog: distinct cards share names across Un-sets and tokens, and
  `oracle_id` is the field Scryfall provides for exactly this.
- **`/index` for the browse route now.** Rejected: it collides with M5, and this
  ticket ships no search, so the name would arrive half-delivered.

## Reasoning

The dependency question was the only real one, and 0010 had already framed it
with a trigger rather than a flat no. Taking the library at the moment the
trigger fires keeps that ADR honest and costs one provider plus a test wrapper.

Everything else follows the project's existing grain: additive API changes over
new routes, the domain vocabulary from CLAUDE.md for anything a person reads, and
no browser modals in a codebase whose test strategy is a real browser.
