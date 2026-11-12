import type { SearchFolio } from '../api'

/** Where a folio's name links: its printing page in the Index. */
export function printingPath(folio: SearchFolio): string {
  return `/index/${encodeURIComponent(folio.scryfall_id)}`
}

/** "2 of 4 in Tomes · 2 free", the same wording as the Catalog row. */
export function reservedLine(folio: SearchFolio): string {
  return `${folio.reserved} of ${folio.quantity} in Tomes · ${folio.available} free`
}

/**
 * Whether a finish gets a word after the card's name. Nonfoil is the plain
 * case and says nothing, so the caller adds no space before it either.
 */
export function hasFinishWord(finish: string): boolean {
  return finish === 'foil' || finish === 'etched'
}
