import { describe, expect, it } from 'vitest'
import { describePrinting } from './printing'

describe('describePrinting', () => {
  it('formats set name, upper-cased code, and collector number', () => {
    expect(
      describePrinting({
        set_name: 'Limited Edition Alpha',
        set_code: 'lea',
        collector_number: '161',
      }),
    ).toBe('Limited Edition Alpha (LEA) · #161')
  })
})
