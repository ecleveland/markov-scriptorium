import { describe, expect, it } from 'vitest'
import { deck } from '../test/fixtures'
import { readDeckId, spineEdge, tallySentence } from './status'

describe('readDeckId', () => {
  it.each([undefined, 'abc', '0', '-1', '1.5'])(
    'reads %s as no Tome',
    (raw) => {
      expect(readDeckId(raw)).toBeNull()
    },
  )

  it('reads a positive integer', () => {
    expect(readDeckId('7')).toBe(7)
  })
})

describe('spineEdge', () => {
  it('gilds an active Tome, whatever its format', () => {
    expect(spineEdge(deck({ status: 'active', format: 'cube' }))).toBe('gold')
  })

  it('greens a cube that is not yet active, in any case and spacing', () => {
    expect(spineEdge(deck({ status: 'in_progress', format: 'cube' }))).toBe(
      'moss',
    )
    expect(spineEdge(deck({ status: 'shelved', format: ' Cube ' }))).toBe(
      'moss',
    )
  })

  it('leaves every other Tome oxblood, a formatless one included', () => {
    expect(spineEdge(deck({ status: 'playtest', format: 'commander' }))).toBe(
      'oxblood',
    )
    expect(spineEdge(deck({ status: 'in_progress', format: null }))).toBe(
      'oxblood',
    )
  })
})

describe('tallySentence', () => {
  it('counts the cards, those in hand, and those needed in words', () => {
    expect(tallySentence({ cards: 5, have: 3, needed: 2 })).toBe(
      'Five cards, three in hand, two needed.',
    )
  })

  it('says none for a zero in hand or needed', () => {
    expect(tallySentence({ cards: 2, have: 2, needed: 0 })).toBe(
      'Two cards, two in hand, none needed.',
    )
    expect(tallySentence({ cards: 1, have: 0, needed: 1 })).toBe(
      'One card, none in hand, one needed.',
    )
  })

  it('reads an empty Tome', () => {
    expect(tallySentence({ cards: 0, have: 0, needed: 0 })).toBe(
      'No cards, none in hand, none needed.',
    )
  })

  it('sets a hundred and more in figures', () => {
    expect(tallySentence({ cards: 100, have: 80, needed: 20 })).toBe(
      '100 cards, eighty in hand, twenty needed.',
    )
  })
})
