# 0021 Inventory search API

**Status:** accepted (2026-10-12)

Resolves [VEG-227]. Decides the shape of `GET /inventory/search`, the endpoint
The Index ([VEG-228]) will browse through. Builds on [0009](0009-inventory-schema.md)
(the lot model), [0016](0016-inventory-browse-and-data-fetching.md), which
deferred search to this ticket, and [0020](0020-reservation-rule.md) for the
reserved and available counts each row carries.

[VEG-227]: https://linear.app/vega-apps/issue/VEG-227
[VEG-228]: https://linear.app/vega-apps/issue/VEG-228

---

## Decision

**A search result is a folio, not a lot.** One row per (printing, finish). The
lots of that folio collapse into one row with `quantity` summed, a `lots` count,
and sorted distinct `conditions`, `locations` and `tags`. The row also carries
the card display object the other inventory reads use and the folio's `reserved`
and `available` counts.

**Lot-level filters select folios. Totals stay whole-folio.** A folio matches
when one of its lots passes every lot-level filter together, so
`condition=LP&tag=trade` means an LP copy that is tagged for trade, not an LP
copy and a separately tagged one. The numbers on the row are then computed over
every lot of that folio, not only the matching lot. Otherwise `available` could
exceed `quantity` on a filtered row, which reads as a bug.

**Facet semantics.** A repeated value within one parameter is any-of
(`finish=foil&finish=etched`). Different parameters combine with AND. The one
exception is `color_identity`, which is "within", meaning the card's identity
is a subset of the requested colors. That is the deck-building question, and
any-of would return a five-color card for a mono-blue request. A blank value in
any parameter, such as `set=` from an unselected dropdown, applies no filter.
`C` means colorless in both color parameters. `colors` also checks
`card_faces.colors`, because Scryfall leaves the top-level array null for some
two-faced layouts, and a card counts as colorless only when neither it nor any
face has a color. A NULL `color_identity`, which only hand-seeded rows have,
falls back to `colors`.

**"Date added" is insertion order.** The `added` sort key orders by the highest
lot id in the folio. The inventory table has no `created_at` (0009 left it out),
and adding one would mean rebuilding the table, because SQLite cannot add a
column with an expression default. The lot id is what `GET /inventory` already
uses for "newest first". `acquired_at` was rejected as the key because it is
user entered and usually blank for pasted and CSV imports.

**Name and type are `LIKE '%q%'`, not the trigram index.** The query runs over
owned printings, hundreds to a few thousand rows, not the whole catalog, so the
scan 0008 avoided is not a concern here. The ticket asks for substring matching,
which `LIKE` gives exactly. The type match reads the card's `type_line` and the
faces' `type_line`, because reversible cards carry it only on the faces.

Default order is newest first for `added` and largest first for `quantity`,
ascending for `name` and `set`. `set` orders by set code, then collector number
cast to an integer, the same ordering the cross-printing summary uses.

## Alternatives

- **One lot per row**, the same shape as `GET /inventory`. Smaller change and the
  filters would be exact. Rejected because a card grid wants one tile per
  physical kind of card, and a playset bought twice should not show as two
  tiles.
- **Filtered totals**, where a `condition=LP` filter reports only the LP
  quantity. Rejected because `reserved` is a folio number and cannot be split by
  condition, so the row would become inconsistent with itself.
- **A `created_at` migration.** Deferred. Revisit if the Index needs a real
  timestamp rather than an order.
- **Any-of for `color_identity`.** Rejected, see above.

## Consequences

- VEG-228 gets its tiles, facets and sort keys from one request. Price sort is
  not in this ticket and will need the `cards.price_*` columns joined in.
- The folio detail page is `GET /inventory/card/{scryfall_id}`, which already
  exists, so click-through needs no new endpoint.
- If a `volumes` table arrives ([VEG-279]), the `location` filter moves from a
  text match to an id match. The parameter name can stay.

[VEG-279]: https://linear.app/vega-apps/issue/VEG-279
