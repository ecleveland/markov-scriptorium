import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Seal } from './Seal'

describe('Seal', () => {
  it('draws the wax, ring, and monogram as a decorative svg', () => {
    const { container } = render(<Seal />)
    const svg = container.querySelector('svg')
    expect(svg).toHaveClass('seal')
    expect(svg).toHaveAttribute('viewBox', '0 0 48 48')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).toHaveAttribute('focusable', 'false')
    expect(svg).not.toHaveAttribute('role')
    expect(container.querySelector('path.seal__wax')).not.toBeNull()
    expect(container.querySelector('circle.seal__ring')).not.toBeNull()
    expect(container.querySelector('text.seal__mark')).toHaveTextContent('M')
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
