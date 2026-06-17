import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CardPrinting } from '../api'
import { InscribeForm } from './InscribeForm'
import { coerceQuantity } from './quantity'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return { ...actual, inscribe: vi.fn() }
})

import { inscribe } from '../api'

const inscribeMock = vi.mocked(inscribe)

function printing(overrides: Partial<CardPrinting>): CardPrinting {
  return {
    scryfall_id: 'lea-bolt',
    name: 'Lightning Bolt',
    set_code: 'lea',
    set_name: 'Limited Edition Alpha',
    collector_number: '161',
    rarity: 'common',
    finishes: ['nonfoil', 'foil'],
    image_uris: null,
    ...overrides,
  }
}

function finishOptions(): string[] {
  const select = screen.getByLabelText('Finish')
  return within(select)
    .getAllByRole('option')
    .map((o) => (o as HTMLOptionElement).value)
}

afterEach(() => vi.clearAllMocks())

describe('InscribeForm finish derivation', () => {
  it('offers only the finishes the printing exists in, defaulting to the first', () => {
    render(
      <InscribeForm
        printing={printing({ finishes: ['nonfoil', 'etched'] })}
        onInscribed={vi.fn()}
        onChangePrinting={vi.fn()}
      />,
    )
    expect(finishOptions()).toEqual(['nonfoil', 'etched'])
    expect(screen.getByLabelText('Finish')).toHaveValue('nonfoil')
  })

  it('falls back to nonfoil when finishes is null', () => {
    render(
      <InscribeForm
        printing={printing({ finishes: null })}
        onInscribed={vi.fn()}
        onChangePrinting={vi.fn()}
      />,
    )
    expect(finishOptions()).toEqual(['nonfoil'])
  })

  it('falls back to nonfoil when finishes is empty', () => {
    render(
      <InscribeForm
        printing={printing({ finishes: [] })}
        onInscribed={vi.fn()}
        onChangePrinting={vi.fn()}
      />,
    )
    expect(finishOptions()).toEqual(['nonfoil'])
  })
})

describe('coerceQuantity', () => {
  // The pure coercion logic — tested directly because the number input's native
  // min/step validation blocks submitting 0/negative/decimal through the DOM.
  it.each([
    ['', 1],
    ['0', 1],
    ['abc', 1],
    ['2.9', 2],
    ['-3', 1],
    ['4', 4],
  ])('coerces %j to %i', (text, expected) => {
    expect(coerceQuantity(text)).toBe(expected)
  })
})

describe('InscribeForm quantity submission', () => {
  it('submits the typed quantity (cleared → defaults to 1)', async () => {
    const user = userEvent.setup()
    inscribeMock.mockResolvedValue({
      id: 1,
      scryfall_id: 'lea-bolt',
      quantity: 1,
      finish: 'nonfoil',
      condition: 'NM',
      location: null,
      card: {
        name: 'Lightning Bolt',
        set_code: 'lea',
        set_name: 'Limited Edition Alpha',
        collector_number: '161',
        image_uris: null,
      },
    })

    render(
      <InscribeForm
        printing={printing({})}
        onInscribed={vi.fn()}
        onChangePrinting={vi.fn()}
      />,
    )
    const qty = screen.getByLabelText('Quantity')
    await user.clear(qty)
    await user.click(screen.getByRole('button', { name: 'Inscribe' }))

    await waitFor(() =>
      expect(inscribeMock).toHaveBeenCalledWith(
        expect.objectContaining({ quantity: 1 }),
      ),
    )
  })
})
