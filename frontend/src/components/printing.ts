/** The fields needed to name a printing on screen. */
export interface PrintingSummary {
  set_name: string
  set_code: string
  collector_number: string
}

/**
 * What `PrintingChip` needs, the summary fields plus, optionally, Scryfall
 * `image_uris`. Structural on purpose so `CardPrinting`, a folio's `card`, and
 * `PrintingOwnership` all fit without the chip depending on the API module.
 */
export interface PrintingChipPrinting extends PrintingSummary {
  image_uris?: Record<string, string> | null
}

/** "Limited Edition Alpha (LEA) · #161": one printing, one line. */
export function describePrinting(printing: PrintingSummary): string {
  return `${printing.set_name} (${printing.set_code.toUpperCase()}) · #${printing.collector_number}`
}
