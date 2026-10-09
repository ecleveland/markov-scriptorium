import { describe, expect, it } from 'vitest'
import { slot } from '../test/fixtures'
import { byManaValue, byType, sortSlots, typeGroup } from './sort'

describe('typeGroup', () => {
  it.each([
    ['Creature — Vampire Noble', 'Creature'],
    ['Legendary Creature — Vampire', 'Creature'],
    ['Instant', 'Instant'],
    ['Sorcery', 'Sorcery'],
    ['Artifact', 'Artifact'],
    ['Artifact Creature — Golem', 'Creature'],
    ['Enchantment — Aura', 'Enchantment'],
    ['Legendary Planeswalker — Sorin', 'Planeswalker'],
    ['Basic Land — Swamp', 'Land'],
    ['Battle — Siege', 'Battle'],
    ['Kindred Tribal', 'Other'],
    // Land beats Artifact and Enchantment; Creature still beats Land.
    ['Artifact Land', 'Land'],
    ['Enchantment Land — Urza’s Saga', 'Land'],
    ['Land Creature — Forest Dryad', 'Creature'],
  ])('files %s under %s', (typeLine, group) => {
    expect(typeGroup(typeLine)).toBe(group)
  })

  it('files a missing type line under Other', () => {
    expect(typeGroup(null)).toBe('Other')
  })

  it('reads the front face of a double-faced card', () => {
    expect(typeGroup('Creature — Human // Creature — Werewolf')).toBe(
      'Creature',
    )
    expect(typeGroup('Sorcery // Land')).toBe('Sorcery')
  })
})

describe('sortSlots', () => {
  const bolt = slot({
    id: 1,
    card: { name: 'Lightning Bolt', type_line: 'Instant', cmc: 1 },
  })
  const edgar = slot({
    id: 2,
    card: {
      name: 'Edgar Markov',
      type_line: 'Legendary Creature — Vampire',
      cmc: 6,
    },
  })
  const swamp = slot({
    id: 3,
    card: { name: 'Swamp', type_line: 'Basic Land — Swamp', cmc: 0 },
  })
  const ring = slot({
    id: 4,
    card: { name: 'Sol Ring', type_line: 'Artifact', cmc: 1 },
  })
  const odd = slot({
    id: 5,
    card: { name: 'Mystery', type_line: null, cmc: null },
  })
  const anguish = slot({
    id: 6,
    card: { name: 'Anguished Unmaking', type_line: 'Instant', cmc: 3 },
  })

  it('orders by type group in the fixed order, then name', () => {
    const sorted = sortSlots([odd, swamp, bolt, ring, edgar, anguish], 'type')
    expect(sorted.map((s) => s.card.name)).toEqual([
      'Edgar Markov',
      'Anguished Unmaking',
      'Lightning Bolt',
      'Sol Ring',
      'Swamp',
      'Mystery',
    ])
  })

  it('orders by mana value with unknown values last, ties by name', () => {
    const sorted = sortSlots([odd, edgar, ring, swamp, anguish, bolt], 'cmc')
    expect(sorted.map((s) => s.card.name)).toEqual([
      'Swamp',
      'Lightning Bolt',
      'Sol Ring',
      'Anguished Unmaking',
      'Edgar Markov',
      'Mystery',
    ])
  })

  it('orders slots with an unknown mana value by name', () => {
    const zeta = slot({ id: 7, card: { name: 'Zeta', cmc: null } })
    const alpha = slot({ id: 8, card: { name: 'Alpha', cmc: null } })
    expect(sortSlots([zeta, alpha], 'cmc').map((s) => s.card.name)).toEqual([
      'Alpha',
      'Zeta',
    ])
  })

  it('does not reorder its input', () => {
    const input = [ring, bolt]
    sortSlots(input, 'type')
    expect(input).toEqual([ring, bolt])
  })

  it('exposes the comparators', () => {
    expect(byType(bolt, edgar)).toBeGreaterThan(0)
    expect(byManaValue(odd, edgar)).toBeGreaterThan(0)
  })
})
