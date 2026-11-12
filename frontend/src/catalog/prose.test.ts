import { describe, expect, it } from 'vitest'
import {
  capitalised,
  conditionWords,
  counted,
  numberWords,
  printingLine,
  shelfPhrase,
  tomeClaim,
} from './prose'

describe('numberWords', () => {
  it.each([
    [0, 'zero'],
    [1, 'one'],
    [12, 'twelve'],
    [20, 'twenty'],
    [21, 'twenty-one'],
    [42, 'forty-two'],
    [99, 'ninety-nine'],
  ])('writes %i under one hundred in words', (n, words) => {
    expect(numberWords(n)).toBe(words)
  })

  it.each([
    [100, '100'],
    [312, '312'],
    [1240, '1,240'],
  ])('writes %i in grouped figures', (n, figures) => {
    expect(numberWords(n)).toBe(figures)
  })
})

describe('counted', () => {
  it('says "no" for none', () => {
    expect(counted(0, 'folio', 'folios')).toBe('no folios')
  })

  it('takes the singular for one', () => {
    expect(counted(1, 'folio', 'folios')).toBe('one folio')
  })

  it('takes the plural in words under one hundred', () => {
    expect(counted(40, 'folio', 'folios')).toBe('forty folios')
  })

  it('takes the plural in figures from one hundred', () => {
    expect(counted(312, 'folio', 'folios')).toBe('312 folios')
  })
})

describe('capitalised', () => {
  it('upper-cases the first letter only', () => {
    expect(capitalised('forty folios')).toBe('Forty folios')
  })

  it('leaves a leading figure as it is', () => {
    expect(capitalised('312 folios')).toBe('312 folios')
  })

  it('leaves an empty string empty', () => {
    expect(capitalised('')).toBe('')
  })
})

describe('printingLine', () => {
  it('names the set and the collector number', () => {
    expect(
      printingLine({
        set_name: 'Double Masters 2022',
        collector_number: '117',
      }),
    ).toBe('Double Masters 2022, no. 117')
  })
})

describe('shelfPhrase', () => {
  it('says "Unshelved" when the folio has no shelf', () => {
    expect(shelfPhrase([])).toBe('Unshelved')
  })

  it('names a single shelf', () => {
    expect(shelfPhrase(['Red binder'])).toBe('Red binder')
  })

  it('joins two shelves with "and"', () => {
    expect(shelfPhrase(['Red binder', 'Trade box'])).toBe(
      'Red binder and Trade box',
    )
  })

  it('lists three or more with commas and a final "and"', () => {
    expect(shelfPhrase(['A', 'B', 'C'])).toBe('A, B and C')
    expect(shelfPhrase(['A', 'B', 'C', 'D'])).toBe('A, B, C and D')
  })
})

describe('conditionWords', () => {
  it.each([
    ['NM', 'near mint'],
    ['LP', 'lightly played'],
    ['MP', 'moderately played'],
    ['HP', 'heavily played'],
    ['DMG', 'damaged'],
  ])('spells out %s', (code, words) => {
    expect(conditionWords(code)).toBe(words)
  })

  it('returns an unknown code as given', () => {
    expect(conditionWords('PO')).toBe('PO')
  })
})

describe('tomeClaim', () => {
  it('says no Tome claims a folio with nothing reserved', () => {
    expect(tomeClaim({ owned: 4, reserved: 0 })).toBe(
      'Not yet claimed by any Tome.',
    )
  })

  it('says a Tome claims a lone copy', () => {
    expect(tomeClaim({ owned: 1, reserved: 1 })).toBe('Claimed by a Tome.')
  })

  it('says every copy is claimed when Tomes reserve them all', () => {
    expect(tomeClaim({ owned: 4, reserved: 4 })).toBe(
      'Every copy is claimed by Tomes.',
    )
  })

  it('counts an over-reserved folio as every copy claimed', () => {
    // Reservation is computed at read time and is not capped at owned.
    expect(tomeClaim({ owned: 4, reserved: 5 })).toBe(
      'Every copy is claimed by Tomes.',
    )
    expect(tomeClaim({ owned: 1, reserved: 2 })).toBe('Claimed by a Tome.')
  })

  it('counts the claimed copies in words', () => {
    expect(tomeClaim({ owned: 4, reserved: 2 })).toBe(
      'Two of its four copies are claimed by Tomes.',
    )
  })

  it('keeps one claimed copy singular', () => {
    expect(tomeClaim({ owned: 4, reserved: 1 })).toBe(
      'One of its four copies is claimed by a Tome.',
    )
  })

  it('writes counts from one hundred in figures', () => {
    expect(tomeClaim({ owned: 120, reserved: 40 })).toBe(
      'Forty of its 120 copies are claimed by Tomes.',
    )
  })
})
