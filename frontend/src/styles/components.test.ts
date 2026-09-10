// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Contract test for the shared component stylesheet (VEG-423, ADR 0017).
//
// The component layer consumes design tokens only: no raw colours or font
// names may appear here, so a later re-theme is a tokens.css edit and nothing
// else. It must also leave the focus ring alone: index.css draws the ring with
// a single global :focus-visible outline, so no component may set `outline`.
// (box-shadow stays free for elevation; it cannot hide an outline.)

const css = readFileSync(
  fileURLToPath(new URL('./components.css', import.meta.url)),
  'utf8',
)

/** Declarations only: strip comments so prose can mention what is forbidden. */
const declarations = css.replace(/\/\*[\s\S]*?\*\//g, '')

describe('component stylesheet contract', () => {
  it('uses no raw colour values', () => {
    expect(declarations).not.toMatch(/#[0-9a-f]{3,8}\b/i)
    expect(declarations).not.toMatch(/\b(rgba?|hsla?|color-mix)\(/)
    expect(declarations).not.toMatch(
      /:\s*(white|black|red|gold|green|grey|gray)\s*;/,
    )
  })

  it('uses no raw font family names', () => {
    expect(declarations).not.toMatch(/font-family\s*:(?!\s*var\()/)
  })

  it('never sets outline, so the global focus ring survives', () => {
    expect(declarations).not.toMatch(/\boutline(-[a-z]+)?\s*:/)
  })

  it('guards hover rules with :where() so page overrides keep winning', () => {
    // `:not(:disabled)` alone would lift the rule to (0,3,0), beating any page
    // rule written at the natural (0,2,0). ADR 0017 promises pages never need
    // !important, so the guard must be specificity-free.
    expect(declarations).not.toMatch(/:hover:not\(/)
  })

  it('declares the block class for every component', () => {
    for (const block of [
      '.btn',
      '.tag',
      '.panel',
      '.field',
      '.control',
      '.printing-chip',
    ]) {
      expect(declarations, `missing ${block}`).toContain(`${block} {`)
    }
  })
})
