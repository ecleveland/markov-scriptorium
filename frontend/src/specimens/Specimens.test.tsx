import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Specimens } from './Specimens'

// A smoke test. The dev-only specimen sheet must render every component and
// state so the design tickets that follow have one page to review.
describe('Specimens', () => {
  it('renders every button variant', () => {
    render(<Specimens />)
    expect(
      screen.getByRole('heading', { name: 'Specimens' }),
    ).toBeInTheDocument()
    for (const variant of ['primary', 'secondary', 'ghost', 'danger']) {
      expect(
        document.querySelector(`.btn--${variant}`),
        `missing .btn--${variant}`,
      ).not.toBeNull()
    }
    expect(document.querySelector('.btn__seal')).not.toBeNull()
    expect(document.querySelector('.btn:disabled')).not.toBeNull()
  })

  it('renders every tag tone, a panel, fields, and both chip sizes', () => {
    render(<Specimens />)
    for (const tone of ['neutral', 'success', 'warning', 'danger']) {
      expect(document.querySelector(`.tag--${tone}`)).not.toBeNull()
    }
    expect(screen.getByRole('group')).toHaveClass('panel')
    expect(screen.getByLabelText('Finish')).toHaveClass('control')
    expect(screen.getByLabelText('Volume (location)')).toHaveClass('control')
    expect(screen.getByLabelText('Decklist')).toHaveClass('control')
    expect(document.querySelector('.printing-chip--sm')).not.toBeNull()
    expect(document.querySelector('.printing-chip--md')).not.toBeNull()
  })

  it('renders a page header, every notice tone, and a listbox', () => {
    render(<Specimens />)
    expect(document.querySelector('.page-header__eyebrow')).not.toBeNull()
    for (const tone of ['muted', 'success', 'danger']) {
      expect(
        document.querySelector(`.notice--${tone}`),
        `missing .notice--${tone}`,
      ).not.toBeNull()
    }
    const listbox = screen.getByRole('listbox', { name: 'Specimen printings' })
    expect(listbox).toHaveClass('listbox')
    expect(listbox.querySelectorAll('.listbox__option')).toHaveLength(2)
    // One option shows the selected state, so the gold inset rule is visible.
    expect(within(listbox).getAllByRole('option')[1]).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  it('renders the seal, a sealed confirmation, an empty state, and the candle', () => {
    render(<Specimens />)
    for (const selector of [
      '.seal',
      '.sealed',
      '.empty-state',
      '.consulting__candle',
    ]) {
      expect(
        document.querySelector(selector),
        `missing ${selector}`,
      ).not.toBeNull()
    }
  })
})
