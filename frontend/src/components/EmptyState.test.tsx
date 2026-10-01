import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EmptyState } from './EmptyState'

describe('EmptyState', () => {
  it('renders an unpressed seal, a heading, and the body', () => {
    const { container } = render(
      <EmptyState title="Nothing inscribed yet">
        Add a card through <a href="/inscribe">Inscribe</a>.
      </EmptyState>,
    )
    const block = container.firstElementChild
    expect(block).toHaveClass('empty-state')
    expect(block?.querySelector('svg')).toHaveClass('seal', 'empty-state__seal')
    expect(
      screen.getByRole('heading', { level: 2, name: 'Nothing inscribed yet' }),
    ).toHaveClass('empty-state__title')
    const link = screen.getByRole('link', { name: 'Inscribe' })
    expect(link.closest('.empty-state__body')).not.toBeNull()
  })

  it('has no role of its own and passes native props through', () => {
    const { container } = render(
      <EmptyState
        title="Nothing matched"
        id="no-match"
        className="decklist__empty"
      >
        None of the lines matched.
      </EmptyState>,
    )
    const block = container.firstElementChild
    expect(block).not.toHaveAttribute('role')
    expect(block).toHaveAttribute('id', 'no-match')
    expect(block).toHaveClass('empty-state', 'decklist__empty')
  })
})
