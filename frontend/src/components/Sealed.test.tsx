import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Sealed } from './Sealed'

describe('Sealed', () => {
  it('presses the seal beside the default title and the message', () => {
    const { container } = render(
      <Sealed>Inscribed 3 folios (7 copies) into the catalog.</Sealed>,
    )
    const block = container.firstElementChild
    expect(block).toHaveClass('sealed')
    expect(block?.querySelector('svg')).toHaveClass('seal', 'sealed__seal')
    expect(screen.getByText('Sealed into the catalog')).toHaveClass(
      'sealed__title',
    )
    expect(
      screen.getByText('Inscribed 3 folios (7 copies) into the catalog.'),
    ).toHaveClass('sealed__body')
  })

  it('has no role of its own', () => {
    const { container } = render(<Sealed>Done.</Sealed>)
    expect(container.firstElementChild).not.toHaveAttribute('role')
  })

  it('announces through the role the caller passes', () => {
    render(
      <Sealed role="status" title="Sealed into the catalog">
        Inscribed 3 folios (7 copies) into the catalog.
      </Sealed>,
    )
    expect(screen.getByRole('status')).toHaveTextContent(
      'Inscribed 3 folios (7 copies) into the catalog.',
    )
  })

  it('takes a custom title', () => {
    render(<Sealed title="Amended">The folio was amended.</Sealed>)
    expect(screen.getByText('Amended')).toHaveClass('sealed__title')
  })

  it('merges a caller-supplied className', () => {
    const { container } = render(
      <Sealed className="decklist__summary">Done.</Sealed>,
    )
    expect(container.firstElementChild).toHaveClass(
      'sealed',
      'decklist__summary',
    )
  })
})
