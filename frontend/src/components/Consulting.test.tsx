import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Consulting, type ConsultingProps } from './Consulting'

describe('Consulting', () => {
  it('is a muted notice with a candle and the default line', () => {
    render(<Consulting />)
    const line = screen.getByText('Consulting the catalog…').closest('p')
    expect(line).not.toBeNull()
    expect(line).toHaveClass('notice', 'notice--muted', 'consulting')
    const candle = line?.querySelector('.consulting__candle')
    expect(candle).not.toBeNull()
    expect(candle).toHaveAttribute('aria-hidden', 'true')
  })

  it('keeps inline children in one text span, so the flex row has two items', () => {
    const { container } = render(
      <Consulting>
        Retrieving <em>Sol Ring</em> from the catalog…
      </Consulting>,
    )
    const line = container.querySelector('.consulting')
    expect(line?.children).toHaveLength(2)
    const text = line?.querySelector(':scope > .consulting__text')
    expect(text?.tagName).toBe('SPAN')
    expect(text).toHaveTextContent('Retrieving Sol Ring from the catalog…')
    expect(text?.querySelector('em')).toHaveTextContent('Sol Ring')
  })

  it('takes its own wording', () => {
    render(<Consulting>Retrieving the folio…</Consulting>)
    expect(
      screen.getByText('Retrieving the folio…').closest('.consulting'),
    ).not.toBeNull()
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
    expect(
      screen.getByText('Consulting the catalog…').closest('.consulting'),
    ).toHaveClass('catalog__pending')
  })

  it('cannot render inline, because the candle row is a flex box', () => {
    // A type-level check: tsc -b fails if `as` comes back into the props.
    const props: ConsultingProps = {
      // @ts-expect-error `as` is omitted from ConsultingProps
      as: 'span',
    }
    expect(props).toBeDefined()
  })
})
