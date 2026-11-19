import type { InventoryLot } from '../api'
import { capitalised, counted } from '../catalog/prose'

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
 * One inscription as a sentence: "One copy of Sol Ring, C21 no. 263, nonfoil."
 * The session list and the seal both use it, so the confirmation always reads
 * the same as the entry it adds.
 */
export function describeEntry(entry: SessionEntry): string {
  const copies = capitalised(counted(entry.quantity, 'copy', 'copies'))
  return `${copies} of ${entry.name}, ${entry.setCode.toUpperCase()} no. ${entry.collectorNumber}, ${entry.finish}.`
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
