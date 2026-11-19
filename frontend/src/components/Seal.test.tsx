import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Seal } from './Seal'

describe('Seal', () => {
  it('draws the wax, field, lit edge, ring, and monogram as a decorative svg', () => {
    const { container } = render(<Seal />)
    const svg = container.querySelector('svg')
    expect(svg).toHaveClass('seal')
    expect(svg).toHaveAttribute('viewBox', '0 0 48 48')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).toHaveAttribute('focusable', 'false')
    expect(svg).not.toHaveAttribute('role')
    expect(container.querySelector('path.seal__wax')).not.toBeNull()
    expect(container.querySelector('path.seal__field')).not.toBeNull()
    expect(container.querySelector('path.seal__lit')).not.toBeNull()
    expect(container.querySelector('circle.seal__ring')).not.toBeNull()
    const mark = container.querySelector('g.seal__mark')
    expect(mark).not.toBeNull()
    // The M is drawn as strokes, stems and diagonals in one path and serifs
    // in the other, so it never waits on the display font.
    expect(mark?.children).toHaveLength(2)
    for (const child of Array.from(mark?.children ?? [])) {
      expect(child.tagName.toLowerCase()).toBe('path')
    }
    expect(container.querySelector('text')).toBeNull()
  })

  it('merges a caller-supplied className and passes svg props through', () => {
    const { container } = render(
      <Seal className="brand-seal" data-testid="crest" />,
    )
    const svg = container.querySelector('svg')
    expect(svg).toHaveClass('seal', 'brand-seal')
    expect(svg).toHaveAttribute('data-testid', 'crest')
  })
})
