import { render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { describe, expect, it } from 'vitest'
import { Input, Select, Textarea } from './controls'

describe('form controls', () => {
  it('Input adds the control class and forwards native props and refs', () => {
    const ref = createRef<HTMLInputElement>()
    render(
      <Input
        ref={ref}
        aria-label="Card name"
        placeholder="Search the catalog…"
        className="card-search__input"
        disabled
      />,
    )
    const input = screen.getByLabelText('Card name')
    expect(input).toHaveClass('control', 'card-search__input')
    expect(input).toHaveAttribute('placeholder', 'Search the catalog…')
    expect(input).toBeDisabled()
    expect(ref.current).toBe(input)
  })

  it('Select adds the control class and renders its options', () => {
    const ref = createRef<HTMLSelectElement>()
    render(
      <Select ref={ref} aria-label="Finish" defaultValue="foil">
        <option value="nonfoil">nonfoil</option>
        <option value="foil">foil</option>
      </Select>,
    )
    const select = screen.getByLabelText('Finish')
    expect(select).toHaveClass('control')
    expect(select).toHaveValue('foil')
    expect(ref.current).toBe(select)
  })

  it('Textarea adds the control class', () => {
    const ref = createRef<HTMLTextAreaElement>()
    render(<Textarea ref={ref} aria-label="Decklist" rows={12} />)
    const textarea = screen.getByLabelText('Decklist')
    expect(textarea).toHaveClass('control')
    expect(textarea).toHaveAttribute('rows', '12')
    expect(ref.current).toBe(textarea)
  })
})
