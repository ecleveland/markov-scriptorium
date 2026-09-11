import { render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { describe, expect, it } from 'vitest'
import { Panel } from './Panel'

describe('Panel', () => {
  it('is a plain div by default', () => {
    const { container } = render(<Panel>contents</Panel>)
    const panel = container.firstElementChild
    expect(panel?.tagName).toBe('DIV')
    expect(panel).toHaveClass('panel')
    expect(panel).toHaveTextContent('contents')
  })

  it('renders as a fieldset named by its legend', () => {
    render(
      <Panel as="fieldset">
        <legend>Applied to every inscribed card</legend>
        <label>
          Finish <select />
        </label>
      </Panel>,
    )
    const group = screen.getByRole('group', {
      name: 'Applied to every inscribed card',
    })
    expect(group.tagName).toBe('FIELDSET')
    expect(group).toHaveClass('panel')
  })

  it('renders as an aside and merges className', () => {
    render(
      <Panel as="aside" className="decklist__problems" aria-label="Problems">
        oops
      </Panel>,
    )
    const aside = screen.getByRole('complementary', { name: 'Problems' })
    expect(aside).toHaveClass('panel', 'decklist__problems')
  })

  it('types attributes and refs by the rendered element (type-level)', () => {
    const section = createRef<HTMLElement>()
    void (<Panel as="section" ref={section} />)
    const div = createRef<HTMLDivElement>()
    void (<Panel ref={div} />)
    // @ts-expect-error disabled only exists on a fieldset
    void (<Panel disabled />)
    // @ts-expect-error a div ref does not fit a fieldset
    void (<Panel as="fieldset" ref={div} />)
  })

  it('passes fieldset-only props and refs through to the element', () => {
    const ref = createRef<HTMLFieldSetElement>()
    render(
      <Panel as="fieldset" ref={ref} disabled>
        <legend>Sealed</legend>
        <label>
          Finish <select />
        </label>
      </Panel>,
    )
    const group = screen.getByRole('group', { name: 'Sealed' })
    expect(ref.current).toBe(group)
    expect(screen.getByLabelText('Finish')).toBeDisabled()
  })
})
