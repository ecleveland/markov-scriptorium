// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { cssSheets } from '../test/sheets'

// The focus ring is drawn exactly once, by index.css, which sets `outline` on
// :focus-visible (ADR 0017). Every other stylesheet must leave outlines alone
// and must not reuse the ring token in some other property, or keyboard focus
// silently disappears on that page. This walks every sheet under src/.

const sheets = cssSheets({ exclude: ['index.css'] })

describe('focus ring ownership', () => {
  it('finds the page and component sheets', () => {
    expect(sheets.map((s) => s.name)).toContain('styles/components.css')
    expect(sheets.length).toBeGreaterThan(3)
  })

  it.each(sheets)('$name sets no outline', ({ css }) => {
    expect(css).not.toMatch(/\boutline(-[a-z]+)?\s*:/)
  })

  it.each(sheets)('$name does not repurpose the ring token', ({ css }) => {
    expect(css).not.toMatch(/var\(--focus-ring\)/)
  })
})
