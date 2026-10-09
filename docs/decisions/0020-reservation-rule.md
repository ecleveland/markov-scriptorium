# 0020 — Reservation rule

**Status:** accepted (2026-10-08)

Resolves [VEG-224]. Builds on [0018](0018-deck-schema.md), which made Tomes
hybrid: a Tome with `claims_cards = 1` reserves its cards, and a brew with
`claims_cards = 0` only references them. 0018 said a write is refused with 409
"when it would exceed owned". That sentence conflicted with the breakdown
([VEG-223]), which exists to show cards a Tome needs but the user doesn't own.
This ADR replaces it.

[VEG-223]: https://linear.app/vega-apps/issue/VEG-223
[VEG-224]: https://linear.app/vega-apps/issue/VEG-224

---

## Decision

The write-time rule is contested only. A claiming Tome is refused only when
another claiming Tome already holds copies of the same folio (printing plus
finish) and the write would take more than they leave.

For a slot add or slot PATCH in Tome D on folio F:

- `owned` is the sum of inventory quantities for F.
- `held_elsewhere` is the sum of slot quantities for F in every other Tome
  with `claims_cards = 1`, maybeboard excluded.
- `own_before` and `own_after` are D's demand for F across its non-maybeboard
  slots, before and after the write. An add that merges into an existing slot
  counts that slot's quantity.
- The write is refused when D claims cards, the target board is not the
  maybeboard, `own_after > own_before`, `held_elsewhere > 0`, and
  `own_after > MAX(0, owned - held_elsewhere)`.
- Lowering or keeping a Tome's demand on a folio is always allowed, because it
  never takes a copy from anyone.

The refusal is a 409 whose `detail` is an object: a `message` naming the
holding Tomes and suggesting the maybeboard or a brew, and `holders`, a list of
`{deck_id, name, quantity}` ordered by deck id.

The decrease clause matters after a sale. Selling a lot or turning
`claims_cards` on can leave two Tomes over-claimed. Without the clause,
lowering a slot from 4 to 3 in that state would be refused, and the user could
only trim straight down to the free count. Moving a slot to the maybeboard and
deleting a slot are decreases by construction, so neither is ever refused.

The check runs inside the write's transaction, after `BEGIN IMMEDIATE`, so no
other connection can change the counts between the check and the write. The
logic lives in `backend/src/scriptorium/reservations.py`, which imports
nothing from the deck or inventory modules so both can use it.

For reads, `reserved` for a folio sums every claiming Tome's non-maybeboard
slots, and `available` is `MAX(0, owned - reserved)`.

---

## Alternatives considered

- **Strict: refuse whenever a claiming Tome's demand exceeds what is owned and
  unreserved.** Rejected. A sleeved Tome could not list a card the user plans
  to buy, so the breakdown's needed column would never show anything for a
  claiming Tome.
- **Advisory: never refuse, only show the overlap.** Rejected. Two sleeved
  Tomes could both claim the one physical copy, and reservation would mean
  nothing.

---

## Consequences

- With no rival claim, a Tome may ask for any quantity. The excess shows as
  needed.
- If rivals hold every owned copy of a folio, or claim a folio the user owns
  none of, a claiming Tome cannot add it to a counted board. It can go on the
  maybeboard or into a brew.
- These writes never trigger the check: brews, maybeboard slots, deck PATCHes
  (including turning `claims_cards` on), inventory writes such as selling a
  lot, and any slot write that does not raise the Tome's demand for the folio.
  Each may leave a Tome over-claimed, and the breakdown shows it as needed.
- Inventory reads carry the counts:
  - each lot gains `folio: {owned, reserved, available}` for its folio
  - `GET /inventory/card/{scryfall_id}` gains `reservations`, one
    `{finish, owned, reserved, available}` per finish that is owned or
    reserved, ordered by finish
  - each printing in `across_printings` gains `reserved` and `available`
- The breakdown query is unchanged. Its swap hint picks up `reserved` and
  `available` per printing through `across_printings`.
- Per-printing `reserved` sums every finish, so a foil claim can offset
  nonfoil copies in the swap hint. Splitting the hint by finish is deferred.
