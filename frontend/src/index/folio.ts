import type { SearchFolio } from '../api'

/** Where a folio's name links: its printing page in the Index. */
export function printingPath(folio: SearchFolio): string {
  return `/index/${encodeURIComponent(folio.scryfall_id)}`
}

/** "2 of 4 in Tomes · 2 free", the same wording as the Catalog row. */
export function reservedLine(folio: SearchFolio): string {
  return `${folio.reserved} of ${folio.quantity} in Tomes · ${folio.available} free`
}
