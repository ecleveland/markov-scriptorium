import { describe, expect, it } from 'vitest'
import { readDeckId } from './status'

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
