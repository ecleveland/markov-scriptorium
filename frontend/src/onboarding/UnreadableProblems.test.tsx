import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { UnreadableProblems } from './UnreadableProblems'

describe('UnreadableProblems', () => {
  it('renders nothing when every line was readable', () => {
    const { container } = render(
      <UnreadableProblems label="Unreadable lines" noun="Line" problems={[]} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('names the aside by its label and lists one item per problem', () => {
    render(
      <UnreadableProblems
        label="Unreadable rows"
        noun="Row"
        problems={[
          { number: 1, reason: 'missing card name', text: ',cmd,...' },
          { number: 4, reason: 'quantity with no card name', text: '4' },
        ]}
      />,
    )
    const aside = screen.getByRole('complementary', { name: 'Unreadable rows' })
    expect(
      within(aside).getByRole('heading', { name: 'Unreadable rows' }),
    ).toBeInTheDocument()
    const items = within(aside).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('Row 1: missing card name — “,cmd,...”')
    expect(items[1]).toHaveTextContent('Row 4: quantity with no card name')
  })
})
