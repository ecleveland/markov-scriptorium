import type { DeckSlot } from '../api'

/** The card-type groups the editor sorts by, in the order they are read. */
export const TYPE_GROUPS = [
  'Creature',
  'Planeswalker',
  'Battle',
  'Instant',
  'Sorcery',
  'Artifact',
  'Enchantment',
  'Land',
  'Other',
] as const
export type TypeGroup = (typeof TYPE_GROUPS)[number]

export type SlotSort = 'type' | 'cmc'

/**
 * The group a type line files under, the way decklists are read. Creature wins
 * over everything, so an artifact creature or Dryad Arbor sits with the
 * creatures. Land wins next, so an artifact land or Urza's Saga sits with the
 * lands. Anything else takes its first type in `TYPE_GROUPS` order. Only the
 * front face counts on a double-faced card.
 */
export function typeGroup(typeLine: string | null): TypeGroup {
  if (typeLine === null) return 'Other'
  const front = typeLine.split('//')[0]
  const types = front.split('—')[0].split(/\s+/)
  if (types.includes('Creature')) return 'Creature'
  if (types.includes('Land')) return 'Land'
  return TYPE_GROUPS.find((group) => types.includes(group)) ?? 'Other'
}

function byName(a: DeckSlot, b: DeckSlot): number {
  return a.card.name.localeCompare(b.card.name) || a.id - b.id
}

export function byType(a: DeckSlot, b: DeckSlot): number {
  const rank = (slot: DeckSlot) =>
    TYPE_GROUPS.indexOf(typeGroup(slot.card.type_line))
  return rank(a) - rank(b) || byName(a, b)
}

/** Mana value ascending; a card with no mana value sorts last. */
export function byManaValue(a: DeckSlot, b: DeckSlot): number {
  const value = (slot: DeckSlot) => slot.card.cmc ?? Number.POSITIVE_INFINITY
  const diff = value(a) - value(b)
  if (Number.isNaN(diff)) return byName(a, b)
  return diff || byName(a, b)
}

/** A sorted copy of `slots`; the input is left alone. */
export function sortSlots(
  slots: readonly DeckSlot[],
  sort: SlotSort,
): DeckSlot[] {
  return [...slots].sort(sort === 'cmc' ? byManaValue : byType)
}
