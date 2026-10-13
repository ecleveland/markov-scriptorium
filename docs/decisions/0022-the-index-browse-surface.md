# 0022 The Index browse surface

**Status:** accepted (2026-10-13)

Resolves [VEG-228]. Decides where The Index lives, how its filter sidebar
learns which values exist, and where a result leads when clicked. Builds on
[0016](0016-inventory-browse-and-data-fetching.md), which put the Catalog at
`/catalog`, rejected `/index` for it because that name belonged to M5, and
said The Index would build on the Catalog rather than replace it. Reads
[0021](0021-inventory-search-api.md), the search endpoint, and adds one
sibling endpoint to it.

[VEG-228]: https://linear.app/vega-apps/issue/VEG-228

---

## Decision

**The Index is a second browse view at `/index`, and it is the landing route.**
`/` redirects there. The Catalog stays at `/catalog` as the per-lot ledger. The
two answer different questions. The Index asks "what do I own", one tile per
folio, filtered and sorted. The Catalog asks "what did I inscribe, and in what
state", one row per lot, with the quantity stepper in the row. Folding the
ledger into the Index would have meant losing in-row editing or putting a
per-lot stepper on a per-folio tile. The nav lists Index first.

**Facet values come from `GET /inventory/facets`.** The sidebar needs the owned
set codes, volumes and tags to offer as checkboxes, and nothing listed them.
The endpoint returns three lists over the whole owned collection, each value
with the number of folios carrying it:

```
{ sets:      [{set_code, set_name, folios}],
  locations: [{location, folios}],
  tags:      [{tag, folios}] }
```

Counts are not narrowed by the other active filters. True faceted counts need
one aggregate per facet per request and the collection is small enough that
discovering a value matters more than predicting its hit count. Volumes group
case-insensitively with the first spelling as the label, because the search's
`location` filter folds case and two checkboxes that filter identically would be
a bug. Tags group exactly, because the tag filter is exact. Color, type, finish
and condition are fixed vocabularies and ship with the frontend.

**A tile opens a printing page at `/index/:scryfallId`.** A result is a folio,
a (printing, finish), and may span several lots, while the existing detail page
is per lot. The printing page reads `GET /inventory/card/{scryfall_id}`, which
already carries the card, every lot of the printing, the per-finish
reservations and the cross-printing total. It renders the lots as Catalog rows,
stepper included, each linking on to `/catalog/{lot_id}`. No new backend read.

**The URL is the state.** Every filter, the search text, the sort, the order,
the view and the page are query parameters named exactly as the API names them,
plus `view` and `page`. Opening a printing and coming back restores the view,
and a filtered Index is a link. Typing in the search box replaces the history
entry rather than pushing one per keystroke.

**Pagination, not infinite scroll.** Previous and Next, 24 to a page, the same
shape the Catalog uses. Infinite scroll loses your place on the round trip to a
printing and fights the URL-as-state rule.

**Type-ahead suggests owned names only.** The suggestions come from the search
endpoint itself, deduplicated by card name, not from `/cards/autocomplete`,
which would offer cards the user does not own.

**Type is a single choice.** The search endpoint takes one `type` substring, so
the sidebar offers a select of the card types rather than checkboxes. Any-of
over types would need a backend change the ticket did not ask for.

**`CardThumb` joins the component layer.** 0017 said to move it when a consumer
outside the Catalog appeared. The Index tile is that consumer.

## Alternatives

- **The Index replaces the Catalog at `/catalog`.** One screen, no second nav
  entry. Rejected because the lot table with its stepper is the only place to
  adjust quantities without opening each lot, and a per-folio tile cannot carry
  a per-lot stepper.
- **Free-text set, volume and tag fields** instead of a facets endpoint. No
  backend change, but a sidebar you have to already know the answers to is not
  faceted browsing.
- **Facet values derived from the current page of results.** Values off the
  page never appear, so filters cannot be discovered.
- **Link a tile to its newest lot.** No new page, but a folio with three lots
  would hide two of them behind the Catalog.
- **Expand a tile in place to show its lots.** No new route, but the printing
  page also wants the reservations and the cross-printing total, and those
  belong on a page, not in a grid cell.

## Consequences

- Price sort is still absent. The ticket lists it; 0021 deferred it to a
  `cards.price_*` join. The sort control offers date added, name, set and copies.
- Every inventory write already invalidates `inventoryKeys.all`, so the search
  and facets queries refresh after an inscription or an amendment with no new
  wiring.
- If a `volumes` table arrives ([VEG-279]), the facets endpoint's `locations`
  list becomes a read of that table and the sidebar's checkboxes do not change.
- The E2E stubs now carry `/inventory/search` and `/inventory/facets`, filtered
  in the browser over the seeded lots. Only the filters the specs exercise are
  stubbed; a new spec that filters on another facet must extend the stub.

[VEG-279]: https://linear.app/vega-apps/issue/VEG-279
