/**
 * The fields that name a printing on screen, plus Scryfall `image_uris` when
 * the caller has them. Structural on purpose so `CardPrinting`, a folio's
 * `card`, and `PrintingOwnership` all fit without this module depending on
 * the API client.
 */
export interface PrintingSummary {
  set_name: string
  set_code: string
  collector_number: string
  image_uris?: Record<string, string> | null
}

/** "Limited Edition Alpha (LEA) · #161": one printing, one line. */
export function describePrinting(printing: PrintingSummary): string {
  return `${printing.set_name} (${printing.set_code.toUpperCase()}) · #${printing.collector_number}`
}
