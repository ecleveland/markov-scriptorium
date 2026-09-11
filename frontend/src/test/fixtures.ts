// Shared builders for the inventory shapes the API returns. Test-only: nothing
// in src imports these, so they never reach the bundle.

import type {
  AcrossPrintings,
  CardPrinting,
  InventoryLot,
  OwnedForPrinting,
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
  const { card, ...rest } = overrides
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
    total_quantity: 1,
    across_printings: across(),
    ...overrides,
  }
}
