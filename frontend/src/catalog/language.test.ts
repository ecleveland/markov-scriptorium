import { describe, expect, it } from 'vitest'
import { languageName } from './language'

describe('languageName', () => {
  it.each([
    ['en', 'English'],
    ['ja', 'Japanese'],
    ['de', 'German'],
    ['fr', 'French'],
    ['it', 'Italian'],
    ['es', 'Spanish'],
    ['pt', 'Portuguese'],
    ['ru', 'Russian'],
    ['ko', 'Korean'],
    ['zhs', 'Simplified Chinese'],
    ['zht', 'Traditional Chinese'],
  ])('spells %s as %s', (code, name) => {
    expect(languageName(code)).toBe(name)
  })

  it('gives an unknown code back as it came', () => {
    expect(languageName('ph')).toBe('ph')
  })
})
