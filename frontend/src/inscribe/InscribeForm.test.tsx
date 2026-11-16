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

describe('InscribeForm plate', () => {
  it('sets the name, the printing line and the four fields on the plate', () => {
    render(
      <InscribeForm
        printing={printing({})}
        onInscribed={vi.fn()}
        onChangePrinting={vi.fn()}
      />,
    )
    const plate = screen.getByRole('region', { name: 'Inscribe this printing' })
    expect(
      within(plate).getByRole('heading', { level: 2, name: 'Lightning Bolt' }),
    ).toBeInTheDocument()
    expect(
      within(plate).getByText('Limited Edition Alpha, no. 161, common.'),
    ).toBeInTheDocument()
    expect(
      within(plate).getByRole('img', {
        name: 'Lightning Bolt (no image in the catalog)',
      }),
    ).toBeInTheDocument()
    for (const label of ['Finish', 'Condition', 'Quantity', 'Volume']) {
      expect(within(plate).getByLabelText(label)).toBeInTheDocument()
    }
    expect(
      within(plate).getByRole('button', { name: 'Inscribe' }),
    ).toBeInTheDocument()
  })

  it('goes back to the printings on Change printing', async () => {
    const user = userEvent.setup()
    const onChangePrinting = vi.fn()
    render(
      <InscribeForm
        printing={printing({})}
        onInscribed={vi.fn()}
        onChangePrinting={onChangePrinting}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Change printing' }))
    expect(onChangePrinting).toHaveBeenCalledOnce()
    expect(inscribeMock).not.toHaveBeenCalled()
  })

  it('shows the reason the backend gave when the inscription fails', async () => {
    const user = userEvent.setup()
    const { ApiError } =
      await vi.importActual<typeof import('../api')>('../api')
    inscribeMock.mockRejectedValue(
      new ApiError('bad finish', 422, 'finish is not offered'),
    )
    render(
      <InscribeForm
        printing={printing({})}
        onInscribed={vi.fn()}
        onChangePrinting={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Inscribe' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This card could not be inscribed: finish is not offered',
    )
  })
})

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
  // The pure coercion logic, tested directly because the number input's native
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
  it('submits the typed quantity, falling back to 1 when cleared', async () => {
    const user = userEvent.setup()
    inscribeMock.mockResolvedValue({
      id: 1,
      scryfall_id: 'lea-bolt',
      quantity: 1,
      finish: 'nonfoil',
      condition: 'NM',
      language: 'en',
      location: null,
      acquired_at: null,
      price_paid: null,
      notes: null,
      tags: null,
      folio: { owned: 1, reserved: 0, available: 1 },
      card: {
        name: 'Lightning Bolt',
        set_code: 'lea',
        set_name: 'Limited Edition Alpha',
        collector_number: '161',
        rarity: 'common',
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
