import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Notice } from './Notice'

describe('Notice', () => {
  it('is a muted paragraph by default', () => {
    render(<Notice>Consulting the catalog…</Notice>)
    const notice = screen.getByText('Consulting the catalog…')
    expect(notice.tagName).toBe('P')
    expect(notice).toHaveClass('notice', 'notice--muted')
  })

  it.each(['danger', 'success', 'muted'] as const)(
    'carries the %s tone',
    (tone) => {
      render(<Notice tone={tone}>Something happened</Notice>)
      expect(screen.getByText('Something happened')).toHaveClass(
        `notice--${tone}`,
      )
    },
  )

  it('passes a role through so it can announce itself', () => {
    render(
      <Notice tone="danger" role="alert">
        The catalog could not be reached.
      </Notice>,
    )
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The catalog could not be reached.',
    )
  })

  it('merges a caller-supplied className', () => {
    render(<Notice className="decklist__counts">3 ready</Notice>)
    expect(screen.getByText('3 ready')).toHaveClass(
      'notice',
      'notice--muted',
      'decklist__counts',
    )
  })

  it('renders as an inline span when asked', () => {
    render(
      <Notice as="span" tone="danger" role="alert">
        not saved
      </Notice>,
    )
    const notice = screen.getByRole('alert')
    expect(notice.tagName).toBe('SPAN')
    expect(notice).toHaveClass('notice', 'notice--danger', 'notice--inline')
  })

  it('is not inline as a paragraph', () => {
    render(<Notice>A line.</Notice>)
    expect(screen.getByText('A line.')).not.toHaveClass('notice--inline')
  })
})
