import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { PrintingOwnership } from '../api'
import { PrintingChip, type PrintingChipPrinting } from './PrintingChip'

const bolt = {
  set_name: 'Limited Edition Alpha',
  set_code: 'lea',
  collector_number: '161',
  image_uris: null,
}

describe('PrintingChip', () => {
  it('describes the printing and omits the thumbnail when there is no art', () => {
    const { container } = render(<PrintingChip printing={bolt} />)
    expect(
      screen.getByText('Limited Edition Alpha (LEA) · #161'),
    ).toBeInTheDocument()
    expect(container.querySelector('img')).toBeNull()
    expect(container.firstElementChild).toHaveClass(
      'printing-chip',
      'printing-chip--sm',
    )
  })

  it('shows decorative art lazily when the printing has a small image', () => {
    render(
      <PrintingChip
        printing={{ ...bolt, image_uris: { small: 'https://img/bolt.jpg' } }}
        size="md"
      />,
    )
    const img = screen.getByRole('presentation')
    expect(img).toHaveAttribute('src', 'https://img/bolt.jpg')
    expect(img).toHaveAttribute('alt', '')
    expect(img).toHaveAttribute('loading', 'lazy')
    expect(img).toHaveClass('printing-chip__thumb')
    expect(img.closest('.printing-chip')).toHaveClass('printing-chip--md')
  })

  it('keeps the text inside a button accessible by set name', () => {
    render(
      <button type="button">
        <PrintingChip printing={bolt} />
      </button>,
    )
    expect(
      screen.getByRole('button', { name: /Limited Edition Alpha/ }),
    ).toBeInTheDocument()
  })

  it('accepts any printing shape with the summary fields, art optional', () => {
    const owned: PrintingOwnership = {
      scryfall_id: 'lea-bolt',
      set_code: 'lea',
      set_name: 'Limited Edition Alpha',
      collector_number: '161',
      rarity: 'common',
      quantity: 2,
      lots: 1,
    }
    const printing: PrintingChipPrinting = owned
    render(<PrintingChip printing={printing} />)
    expect(
      screen.getByText('Limited Edition Alpha (LEA) · #161'),
    ).toBeInTheDocument()
  })

  it('gives the reserved slot back when the art fails to load', () => {
    render(
      <PrintingChip
        printing={{ ...bolt, image_uris: { small: 'https://img/gone.jpg' } }}
      />,
    )
    const img = screen.getByRole('presentation')
    expect(img).not.toHaveAttribute('hidden')
    fireEvent.error(img)
    expect(img).toHaveAttribute('hidden')
  })
})
