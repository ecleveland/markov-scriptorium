/** The fields needed to name a printing on screen. */
export interface PrintingSummary {
  set_name: string
  set_code: string
  collector_number: string
}

/** "Limited Edition Alpha (LEA) · #161": one printing, one line. */
export function describePrinting(printing: PrintingSummary): string {
  return `${printing.set_name} (${printing.set_code.toUpperCase()}) · #${printing.collector_number}`
}
