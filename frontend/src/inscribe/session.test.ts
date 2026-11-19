import { describe, expect, it } from 'vitest'
import { describeEntry, type SessionEntry } from './session'

function entry(overrides: Partial<SessionEntry>): SessionEntry {
  return {
    id: 1,
    name: 'Sol Ring',
    setCode: 'c21',
    collectorNumber: '263',
    quantity: 1,
    finish: 'nonfoil',
    ...overrides,
  }
}

describe('describeEntry', () => {
  it('writes one copy as a sentence with the set code and number', () => {
    expect(describeEntry(entry({}))).toBe(
      'One copy of Sol Ring, C21 no. 263, nonfoil.',
    )
  })

  it('spells several copies in words', () => {
    expect(describeEntry(entry({ quantity: 4 }))).toBe(
      'Four copies of Sol Ring, C21 no. 263, nonfoil.',
    )
  })

  it('names a foil finish', () => {
    expect(
      describeEntry(
        entry({
          name: 'Lightning Bolt',
          setCode: 'lea',
          collectorNumber: '161',
          quantity: 2,
          finish: 'foil',
        }),
      ),
    ).toBe('Two copies of Lightning Bolt, LEA no. 161, foil.')
  })
})
