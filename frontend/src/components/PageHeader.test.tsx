import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PageHeader } from './PageHeader'

describe('PageHeader', () => {
  it('renders the title as an h1 by default', () => {
    render(<PageHeader title="Inscribe a Card" />)
    const heading = screen.getByRole('heading', { name: 'Inscribe a Card' })
    expect(heading.tagName).toBe('H1')
    expect(heading).toHaveClass('page-header__title')
  })

  it('renders an h2 for a heading inside a page', () => {
    render(<PageHeader level={2} title="Choose a printing" />)
    expect(
      screen.getByRole('heading', { name: 'Choose a printing', level: 2 }),
    ).toBeInTheDocument()
  })

  it('takes a title node, not only a string', () => {
    render(<PageHeader title={<>Sol Ring — Commander 2021</>} />)
    expect(
      screen.getByRole('heading', { name: 'Sol Ring — Commander 2021' }),
    ).toBeInTheDocument()
  })

  it('renders the eyebrow only when one is given', () => {
    const { container, rerender } = render(<PageHeader title="Review" />)
    expect(container.querySelector('.page-header__eyebrow')).toBeNull()
    rerender(<PageHeader eyebrow="Decklist import" title="Review" />)
    expect(screen.getByText('Decklist import')).toHaveClass(
      'page-header__eyebrow',
    )
  })

  it('renders the actions wrapper only when it has children', () => {
    const { container, rerender } = render(<PageHeader title="Review" />)
    expect(container.querySelector('.page-header__actions')).toBeNull()
    rerender(
      <PageHeader title="Review">
        <button type="button">Edit decklist</button>
      </PageHeader>,
    )
    const actions = container.querySelector('.page-header__actions')
    expect(actions).not.toBeNull()
    expect(
      screen.getByRole('button', { name: 'Edit decklist' }).closest('div'),
    ).toBe(actions)
  })

  it('merges a caller className and passes attributes through', () => {
    render(
      <PageHeader
        title="Review"
        className="decklist__header"
        aria-label="Review the decklist"
      />,
    )
    const header = screen.getByRole('banner', { name: 'Review the decklist' })
    expect(header).toHaveClass('page-header', 'decklist__header')
  })
})
