import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Consulting } from './Consulting'

describe('Consulting', () => {
  it('is a muted notice with a candle and the default line', () => {
    render(<Consulting />)
    const line = screen.getByText('Consulting the catalog…')
    expect(line.tagName).toBe('P')
    expect(line).toHaveClass('notice', 'notice--muted', 'consulting')
    const candle = line.querySelector('.consulting__candle')
    expect(candle).not.toBeNull()
    expect(candle).toHaveAttribute('aria-hidden', 'true')
  })

  it('takes its own wording', () => {
    render(<Consulting>Retrieving the folio…</Consulting>)
    expect(screen.getByText('Retrieving the folio…')).toHaveClass('consulting')
    expect(screen.queryByText('Consulting the catalog…')).toBeNull()
  })

  it('has no role by default but passes one through', () => {
    const { container, rerender } = render(<Consulting />)
    expect(container.firstElementChild).not.toHaveAttribute('role')
    rerender(<Consulting role="status" />)
    expect(screen.getByRole('status')).toHaveTextContent(
      'Consulting the catalog…',
    )
  })

  it('merges a caller-supplied className', () => {
    render(<Consulting className="catalog__pending" />)
    expect(screen.getByText('Consulting the catalog…')).toHaveClass(
      'consulting',
      'catalog__pending',
    )
  })
})
