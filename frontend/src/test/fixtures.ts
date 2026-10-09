// Shared builders for the inventory shapes the API returns. Test-only: nothing
// in src imports these, so they never reach the bundle.

import type {
  AcrossPrintings,
  BreakdownLine,
  CardPrinting,
  DeckListEntry,
  DeckSlot,
  InventoryLot,
  OwnedForPrinting,
  SlotCard,
} from '../api'

/** A catalog printing, as the search and printings endpoints return it. */
export function printing(overrides: Partial<CardPrinting> = {}): CardPrinting {
  return {
    scryfall_id: 'bolt-lea',
    name: 'Lightning Bolt',
    set_code: 'lea',
    set_name: 'Limited Edition Alpha',
    collector_number: '161',
    rarity: 'common',
    finishes: ['nonfoil'],
    image_uris: null,
    ...overrides,
  }
}

export function lot(overrides: Partial<InventoryLot> = {}): InventoryLot {
  const { card, folio, ...rest } = overrides
  return {
    id: 1,
    scryfall_id: 'bolt-lea',
    quantity: 1,
    finish: 'nonfoil',
    condition: 'NM',
    language: 'en',
    location: null,
    acquired_at: null,
    price_paid: null,
    notes: null,
    tags: null,
    ...rest,
    folio: { owned: 1, reserved: 0, available: 1, ...folio },
    card: {
      name: 'Lightning Bolt',
      set_code: 'lea',
      set_name: 'Limited Edition Alpha',
      collector_number: '161',
      rarity: 'common',
      image_uris: null,
      ...card,
    },
  }
}

export function across(
  overrides: Partial<AcrossPrintings> = {},
): AcrossPrintings {
  return {
    grouping: 'oracle_id',
    oracle_id: 'oracle-bolt',
    name: 'Lightning Bolt',
    total_quantity: 1,
    printing_count: 1,
    printings: [],
    ...overrides,
  }
}

export function owned(
  overrides: Partial<OwnedForPrinting> = {},
): OwnedForPrinting {
  return {
    scryfall_id: 'bolt-lea',
    card: lot().card,
    lots: [],
    rollup: [],
    reservations: [],
    total_quantity: 1,
    across_printings: across(),
    ...overrides,
  }
}

/** A Tome as GET /decks lists it. */
export function deck(overrides: Partial<DeckListEntry> = {}): DeckListEntry {
  return {
    id: 1,
    name: 'Edgar Markov',
    format: 'commander',
    status: 'in_progress',
    claims_cards: true,
    notes: null,
    changelog: null,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    card_count: 0,
    ...overrides,
  }
}

/** The card display object on a slot or breakdown line. */
export function slotCard(overrides: Partial<SlotCard> = {}): SlotCard {
  return {
    name: 'Lightning Bolt',
    set_code: 'lea',
    set_name: 'Limited Edition Alpha',
    collector_number: '161',
    rarity: 'common',
    image_uris: null,
    type_line: 'Instant',
    mana_cost: '{R}',
    cmc: 1,
    ...overrides,
  }
}

export function slot(
  overrides: Omit<Partial<DeckSlot>, 'card'> & {
    card?: Partial<SlotCard>
  } = {},
): DeckSlot {
  const { card, ...rest } = overrides
  return {
    id: 1,
    deck_id: 1,
    scryfall_id: 'bolt-lea',
    finish: 'nonfoil',
    board: 'main',
    quantity: 1,
    ...rest,
    card: slotCard(card),
  }
}

export function breakdownLine(
  overrides: Omit<Partial<BreakdownLine>, 'card'> & {
    card?: Partial<SlotCard>
  } = {},
): BreakdownLine {
  const { card, ...rest } = overrides
  return {
    id: 1,
    board: 'main',
    scryfall_id: 'bolt-lea',
    finish: 'nonfoil',
    quantity: 1,
    owned: 1,
    available: 1,
    have: 1,
    needed: 0,
    swap_hint: null,
    ...rest,
    card: slotCard(card),
  }
}
