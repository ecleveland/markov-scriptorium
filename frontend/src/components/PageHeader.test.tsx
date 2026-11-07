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

  it('keeps the accessible name whole when one word is in rubric', () => {
    render(
      <PageHeader
        title={
          <>
            The <span className="rubric">Index</span>
          </>
        }
      />,
    )
    const heading = screen.getByRole('heading', { name: 'The Index' })
    expect(heading.querySelector('.rubric')).toHaveTextContent('Index')
  })

  it('renders no eyebrow above the title', () => {
    const { container } = render(<PageHeader title="Review" />)
    expect(container.querySelector('.page-header__eyebrow')).toBeNull()
    expect(
      container.querySelector('.page-header__heading')?.children,
    ).toHaveLength(1)
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

  it('renders a falsy-but-real child rather than printing it', () => {
    // `{children && ...}` would leak a bare 0 into the header.
    const { container } = render(<PageHeader title="Review">{0}</PageHeader>)
    expect(container.querySelector('.page-header__actions')).toHaveTextContent(
      '0',
    )
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
