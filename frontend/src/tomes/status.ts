import type { DeckStatus } from '../api'

export const STATUS_LABELS: Record<DeckStatus, string> = {
  in_progress: 'In progress',
  active: 'Active',
  playtest: 'Playtest',
  shelved: 'Shelved',
}

/** "1 card", "60 cards". */
export function cardCount(count: number): string {
  return `${count} ${count === 1 ? 'card' : 'cards'}`
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
