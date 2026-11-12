import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Plate } from './Plate'

const parts = {
  art: <span data-testid="art">art</span>,
  heading: <h2>Lightning Bolt</h2>,
  lines: (
    <>
      <p className="plate__printing">Double Masters 2022, no. 117</p>
      <p>Four copies in the Red binder.</p>
    </>
  ),
}

describe('Plate', () => {
  it('is a header by default', () => {
    const { container } = render(<Plate {...parts} />)
    const root = container.firstElementChild
    expect(root?.tagName).toBe('HEADER')
    expect(root).toHaveClass('plate')
  })

  it('is a labelled section when given a label', () => {
    render(<Plate {...parts} label="The newest inscription" />)
    const region = screen.getByRole('region', {
      name: 'The newest inscription',
    })
    expect(region.tagName).toBe('SECTION')
    expect(region).toHaveClass('plate')
  })

  it('sets the art beside the heading and the lines', () => {
    const { container } = render(<Plate {...parts} />)
    const root = container.firstElementChild as HTMLElement
    expect([...root.children].map((child) => child.className)).toEqual([
      'plate__art',
      'plate__text',
    ])
    expect(root.querySelector('.plate__art')).toContainElement(
      screen.getByTestId('art'),
    )
    const text = root.querySelector('.plate__text') as HTMLElement
    expect([...text.children].map((child) => child.tagName)).toEqual([
      'H2',
      'P',
      'P',
    ])
    expect(
      screen.getByRole('heading', { name: 'Lightning Bolt', level: 2 }),
    ).toBeInTheDocument()
  })

  it('renders the actions wrapper only when there are actions', () => {
    const { container, rerender } = render(<Plate {...parts} />)
    expect(container.querySelector('.plate__actions')).toBeNull()
    rerender(
      <Plate {...parts} actions={<button type="button">Amend</button>} />,
    )
    const actions = container.querySelector('.plate__actions')
    expect(actions?.parentElement).toHaveClass('plate__text')
    expect(actions).toContainElement(
      screen.getByRole('button', { name: 'Amend' }),
    )
  })

  it('merges a caller className', () => {
    const { container } = render(<Plate {...parts} className="index__plate" />)
    expect(container.firstElementChild).toHaveClass('plate', 'index__plate')
  })
})
