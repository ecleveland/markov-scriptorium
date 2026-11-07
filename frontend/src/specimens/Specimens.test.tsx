import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { Specimens } from './Specimens'

/** The sheet renders a back link, so it needs a router around it. */
function renderSpecimens() {
  return render(
    <MemoryRouter>
      <Specimens />
    </MemoryRouter>,
  )
}

// A smoke test. The dev-only specimen sheet must render every component and
// state so the design tickets that follow have one page to review.
describe('Specimens', () => {
  it('renders every button variant', () => {
    renderSpecimens()
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
    renderSpecimens()
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
    renderSpecimens()
    expect(document.querySelector('.page-header__title .rubric')).not.toBeNull()
    for (const tone of ['muted', 'success', 'danger']) {
      expect(
        document.querySelector(`.notice--${tone}`),
        `missing .notice--${tone}`,
      ).not.toBeNull()
    }
    const listbox = screen.getByRole('list', { name: 'Specimen printings' })
    expect(listbox).toHaveClass('listbox')
    const options = listbox.querySelectorAll('.listbox__option')
    expect(options).toHaveLength(2)
    // One option shows the pressed state, so the gold inset rule is visible.
    expect(options[1]).toHaveAttribute('aria-pressed', 'true')
  })

  it('renders the seal, a sealed confirmation, an empty state, and the candle', () => {
    renderSpecimens()
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

  it('renders the type specimen', () => {
    renderSpecimens()
    expect(screen.getByRole('heading', { name: 'Type' })).toBeInTheDocument()
    for (const selector of [
      '.specimens__display',
      '.specimens__body',
      '.specimens__caps',
      '.specimens__figures',
      '.specimens__rubric',
    ]) {
      expect(
        document.querySelector(selector),
        `missing ${selector}`,
      ).not.toBeNull()
    }
  })

  it('renders a status line in each state, without a live region', () => {
    renderSpecimens()
    const lines = Array.from(document.querySelectorAll('.status[data-state]'))
    expect(lines.map((line) => line.getAttribute('data-state'))).toEqual([
      'ok',
      'pending',
      'error',
    ])
    for (const line of lines) {
      expect(line).not.toHaveAttribute('role')
      const dot = line.querySelector('.status-dot')
      expect(dot).toHaveAttribute('aria-hidden', 'true')
      expect(dot).toBeEmptyDOMElement()
    }
  })

  it('renders a back link specimen', () => {
    renderSpecimens()
    expect(
      screen.getByRole('link', { name: 'Back to the Index' }),
    ).toBeInTheDocument()
  })

  it('renders no margin of its own, because the route wrapper draws it', () => {
    renderSpecimens()
    expect(document.querySelector('.leaf__margin')).toBeNull()
  })
})
