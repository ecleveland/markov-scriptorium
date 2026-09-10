import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Tag } from './Tag'

describe('Tag', () => {
  it('is a neutral span with no ARIA role by default', () => {
    render(<Tag>foil</Tag>)
    const tag = screen.getByText('foil')
    expect(tag.tagName).toBe('SPAN')
    expect(tag).toHaveClass('tag', 'tag--neutral')
    expect(tag).not.toHaveAttribute('role')
  })

  it.each(['success', 'warning', 'danger'] as const)(
    'applies the %s tone',
    (tone) => {
      render(<Tag tone={tone}>ready</Tag>)
      expect(screen.getByText('ready')).toHaveClass(`tag--${tone}`)
    },
  )

  it('merges a caller-supplied className', () => {
    render(<Tag className="decklist__pill">unmatched</Tag>)
    expect(screen.getByText('unmatched')).toHaveClass('tag', 'decklist__pill')
  })
})
