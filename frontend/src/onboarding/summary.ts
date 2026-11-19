import { capitalised, counted } from '../catalog/prose'

interface Counts {
  ready: number
  toChoose: number
  unmatched: number
  unreadable: number
  /** The CSV source the parser recognised, when the flow detects one. */
  detected?: string
}

/** "three ready", "none unmatched". The status word stands in for the noun. */
function tally(n: number, word: string): string {
  return n === 0 ? `none ${word}` : counted(n, word, word)
}

/**
 * Where an import preview stands, as one sentence above the ledger: "Three
 * ready, one to choose, none unmatched." The unreadable count joins only when
 * the parser skipped something, and the CSV flow opens with the source it
 * detected.
 */
export function importSummary({
  ready,
  toChoose,
  unmatched,
  unreadable,
  detected,
}: Counts): string {
  const parts = [
    tally(ready, 'ready'),
    tally(toChoose, 'to choose'),
    tally(unmatched, 'unmatched'),
  ]
  if (unreadable > 0) parts.push(tally(unreadable, 'unreadable'))
  const sentence = `${capitalised(parts.join(', '))}.`
  return detected ? `Detected ${detected}. ${sentence}` : sentence
}
