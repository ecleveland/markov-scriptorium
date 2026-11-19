import type { DeckListEntry, DeckStatus } from '../api'
import { capitalised, counted, numberWords } from '../catalog/prose'

export const STATUS_LABELS: Record<DeckStatus, string> = {
  in_progress: 'In progress',
  active: 'Active',
  playtest: 'Playtest',
  shelved: 'Shelved',
}

/** The colour of a spine's left edge on the shelf. */
export type SpineEdge = 'gold' | 'moss' | 'oxblood'

/**
 * Gold for a complete Tome, which is an active one. Moss for a cube, the one
 * format that marks a list rather than a deck. Oxblood for every other Tome.
 */
export function spineEdge(
  deck: Pick<DeckListEntry, 'status' | 'format'>,
): SpineEdge {
  if (deck.status === 'active') return 'gold'
  if ((deck.format ?? '').trim().toLowerCase() === 'cube') return 'moss'
  return 'oxblood'
}

/** A count in words, with "none" for zero: "none needed", "three in hand". */
function noneOr(n: number): string {
  return n === 0 ? 'none' : numberWords(n)
}

/** The breakdown's totals as a sentence: "Five cards, three in hand, two needed." */
export function tallySentence(totals: {
  cards: number
  have: number
  needed: number
}): string {
  const cards = capitalised(counted(totals.cards, 'card', 'cards'))
  return `${cards}, ${noneOr(totals.have)} in hand, ${noneOr(totals.needed)} needed.`
}

/** Read a Tome id from the route, or null when it is not a positive integer. */
export function readDeckId(raw: string | undefined): number | null {
  const id = Number(raw)
  return Number.isInteger(id) && id > 0 ? id : null
}

/** Blank a text field back to null, so "cleared" reaches the API as a clear. */
export function orNull(text: string): string | null {
  return text.trim() === '' ? null : text.trim()
}
