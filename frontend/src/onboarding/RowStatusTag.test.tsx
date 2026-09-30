import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { printing } from '../test/fixtures'
import { RowStatusTag } from './RowStatusTag'

describe('RowStatusTag', () => {
  it('marks a row that matched nothing as unmatched', () => {
    render(<RowStatusTag status="unmatched" chosen={null} />)
    const tag = screen.getByText('unmatched')
    expect(tag).toHaveClass('tag', 'tag--danger')
  })

  it('asks for a printing while an ambiguous row has none', () => {
    render(<RowStatusTag status="ambiguous" chosen={null} />)
    expect(screen.getByText('choose printing')).toHaveClass(
      'tag',
      'tag--warning',
    )
  })

  // A matched row always carries a printing; an ambiguous one does once picked.
  it.each(['matched', 'ambiguous'] as const)(
    'reads a %s row as ready once it carries a printing',
    (status) => {
      render(<RowStatusTag status={status} chosen={printing()} />)
      expect(screen.getByText('ready')).toHaveClass('tag', 'tag--success')
    },
  )
})
