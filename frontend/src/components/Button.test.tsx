import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Button, type ButtonProps } from './Button'

describe('Button', () => {
  it('is a secondary, non-submitting button by default', () => {
    render(<Button>Change card</Button>)
    const button = screen.getByRole('button', { name: 'Change card' })
    expect(button).toHaveAttribute('type', 'button')
    expect(button).toHaveClass('btn', 'btn--secondary')
  })

  it('applies the requested variant and passes native props through', () => {
    render(
      <Button variant="primary" type="submit" disabled>
        Inscribe
      </Button>,
    )
    const button = screen.getByRole('button', { name: 'Inscribe' })
    expect(button).toHaveAttribute('type', 'submit')
    expect(button).toHaveClass('btn--primary')
    expect(button).toBeDisabled()
  })

  it('merges a caller-supplied className', () => {
    render(<Button className="lot-remove__start">Remove</Button>)
    expect(screen.getByRole('button')).toHaveClass('btn', 'lot-remove__start')
  })

  it('renders the wax-seal glyph outside the accessible name', () => {
    const { container } = render(
      <Button variant="primary" seal>
        Inscribe
      </Button>,
    )
    expect(screen.getByRole('button', { name: 'Inscribe' })).toBeInTheDocument()
    const seal = container.querySelector('.btn__seal')
    expect(seal).not.toBeNull()
    expect(seal).toHaveAttribute('aria-hidden', 'true')
  })

  it('has no seal glyph unless asked', () => {
    const { container } = render(<Button>Plain</Button>)
    expect(container.querySelector('.btn__seal')).toBeNull()
  })

  it('ignores the seal on any variant but primary', () => {
    const { container } = render(
      <Button variant="ghost" seal>
        Change
      </Button>,
    )
    expect(container.querySelector('.btn__seal')).toBeNull()
  })

  it('keeps the seal rule under derived props types (type-level)', () => {
    // A flat props type survives Omit/Pick, so wrappers can forward variant
    // and seal from their own optional props without narrowing.
    type Wrapped = Omit<ButtonProps, 'children'>
    const forwarded: Wrapped = { variant: 'ghost', seal: false }
    void (<Button {...forwarded}>Change</Button>)
  })
})
