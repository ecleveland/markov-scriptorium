import type { InventoryLot } from '../api'

/** One inscription made on this visit, as the session list and seal show it. */
export interface SessionEntry {
  id: number
  name: string
  setCode: string
  collectorNumber: string
  quantity: number
  finish: string
}

/**
 * One inscription as a line of text. The session list and the seal both use
 * it, so the confirmation always reads the same as the entry it adds.
 */
export function describeEntry(entry: SessionEntry): string {
  return `${entry.quantity}× ${entry.name} (${entry.setCode.toUpperCase()} #${entry.collectorNumber}) · ${entry.finish}`
}

/** The session entry for a lot the backend just inscribed. */
export function entryFromLot(lot: InventoryLot): SessionEntry {
  return {
    id: lot.id,
    name: lot.card.name,
    setCode: lot.card.set_code,
    collectorNumber: lot.card.collector_number,
    quantity: lot.quantity,
    finish: lot.finish,
  }
}
