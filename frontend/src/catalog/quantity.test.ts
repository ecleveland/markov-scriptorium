import { describe, expect, it } from 'vitest'
import { readQuantity } from './quantity'

describe('readQuantity', () => {
  it('reads a positive whole number', () => {
    expect(readQuantity('12')).toBe(12)
    expect(readQuantity(' 3 ')).toBe(3)
  })

  it('rejects a blank field rather than defaulting it to one copy', () => {
    // The bug this guards: clearing Copies on a 12-copy folio and amending must
    // not PATCH quantity 1. Inscribe's coerceQuantity does exactly that, on
    // purpose, which is why this is a separate function.
    expect(readQuantity('')).toBeNull()
    expect(readQuantity('   ')).toBeNull()
  })

  it('rejects values the inventory CHECK constraint would refuse', () => {
    expect(readQuantity('0')).toBeNull()
    expect(readQuantity('-4')).toBeNull()
  })

  it('rejects fractions and things that are not numbers', () => {
    expect(readQuantity('1.5')).toBeNull()
    expect(readQuantity('four')).toBeNull()
    expect(readQuantity('NaN')).toBeNull()
    expect(readQuantity('Infinity')).toBeNull()
  })
})
