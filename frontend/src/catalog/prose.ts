// The Index and the Catalog describe a folio in sentences rather than table
// cells (VEG-624). Numbers under one hundred go in words and larger ones in
// figures, as a printed catalogue would set them.

const ONES = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
]

const TENS = [
  '',
  '',
  'twenty',
  'thirty',
  'forty',
  'fifty',
  'sixty',
  'seventy',
  'eighty',
  'ninety',
]

/** 0 to 99 in English words ("forty-two"), 100 and up in grouped figures. */
export function numberWords(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n >= 100) {
    return n.toLocaleString('en-US')
  }
  if (n < 20) return ONES[n]
  const tens = TENS[Math.floor(n / 10)]
  const ones = n % 10
  return ones === 0 ? tens : `${tens}-${ONES[ones]}`
}

/** A count with its noun: "no folios", "one folio", "forty folios". */
export function counted(n: number, one: string, many: string): string {
  if (n === 0) return `no ${many}`
  return `${numberWords(n)} ${n === 1 ? one : many}`
}

/** The text with its first character upper-cased and the rest untouched. */
export function capitalised(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** "Double Masters 2022, no. 117". */
export function printingLine(printing: {
  set_name: string
  collector_number: string
}): string {
  return `${printing.set_name}, no. ${printing.collector_number}`
}

/** Where a folio's copies sit: "Unshelved", "Red binder", "A, B and C". */
export function shelfPhrase(locations: readonly string[]): string {
  if (locations.length === 0) return 'Unshelved'
  if (locations.length === 1) return locations[0]
  const last = locations[locations.length - 1]
  return `${locations.slice(0, -1).join(', ')} and ${last}`
}

const CONDITIONS: Record<string, string> = {
  NM: 'near mint',
  LP: 'lightly played',
  MP: 'moderately played',
  HP: 'heavily played',
  DMG: 'damaged',
}

/** A condition code spelled out ("NM" to "near mint"); an unknown code as given. */
export function conditionWords(code: string): string {
  return CONDITIONS[code] ?? code
}

/**
 * The Volume a lot sits in, trimmed, or null when it has none. The backend can
 * hold an empty or all-space location, which reads as unshelved.
 */
export function lotShelf(location: string | null): string | null {
  const shelf = location?.trim() ?? ''
  return shelf === '' ? null : shelf
}

/**
 * One sentence on how much of a folio the Tomes claim. It names the folio,
 * because a lot page or plate shows one lot's copies beside the claim on all
 * of the folio's. Reservation is computed at read time and is not capped at
 * what is owned, so a folio reserved past its copies says by how many.
 */
export function tomeClaim(folio: { owned: number; reserved: number }): string {
  const { owned, reserved } = folio
  if (reserved <= 0) return 'Not yet claimed by any Tome.'
  if (reserved > owned) {
    const short = numberWords(reserved - owned)
    return `Tomes claim ${counted(reserved, 'copy', 'copies')}, ${short} more than the folio holds.`
  }
  if (reserved === owned) {
    return owned === 1
      ? "The folio's one copy is claimed by a Tome."
      : `All ${numberWords(owned)} of the folio's copies are claimed by Tomes.`
  }
  const part = capitalised(numberWords(reserved))
  const whole = numberWords(owned)
  return reserved === 1
    ? `${part} of the folio's ${whole} copies is claimed by a Tome.`
    : `${part} of the folio's ${whole} copies are claimed by Tomes.`
}
