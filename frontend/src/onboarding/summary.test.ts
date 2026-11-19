import { describe, expect, it } from 'vitest'
import { importSummary } from './summary'

describe('importSummary', () => {
  it('says none for every empty count', () => {
    expect(
      importSummary({ ready: 0, toChoose: 0, unmatched: 0, unreadable: 0 }),
    ).toBe('None ready, none to choose, none unmatched.')
  })

  it('spells a single count as one', () => {
    expect(
      importSummary({ ready: 1, toChoose: 1, unmatched: 1, unreadable: 0 }),
    ).toBe('One ready, one to choose, one unmatched.')
  })

  it('spells larger counts in words', () => {
    expect(
      importSummary({ ready: 3, toChoose: 1, unmatched: 0, unreadable: 0 }),
    ).toBe('Three ready, one to choose, none unmatched.')
  })

  it('adds the unreadable count only when there is one', () => {
    expect(
      importSummary({ ready: 3, toChoose: 1, unmatched: 0, unreadable: 1 }),
    ).toBe('Three ready, one to choose, none unmatched, one unreadable.')
  })

  it('opens with the detected format as its own sentence', () => {
    expect(
      importSummary({
        ready: 2,
        toChoose: 0,
        unmatched: 1,
        unreadable: 0,
        detected: 'manabox',
      }),
    ).toBe('Detected manabox. Two ready, none to choose, one unmatched.')
  })
})
