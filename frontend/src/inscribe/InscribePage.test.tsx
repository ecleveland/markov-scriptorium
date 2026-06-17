import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CardPrinting, InventoryLot } from '../api'
import { InscribePage } from './InscribePage'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return {
    ...actual,
    autocompleteNames: vi.fn(),
    searchPrintings: vi.fn(),
    inscribe: vi.fn(),
  }
})

import { autocompleteNames, inscribe, searchPrintings } from '../api'

const autocompleteMock = vi.mocked(autocompleteNames)
const searchMock = vi.mocked(searchPrintings)
const inscribeMock = vi.mocked(inscribe)

function printing(overrides: Partial<CardPrinting>): CardPrinting {
  return {
    scryfall_id: 'id',
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

function lot(overrides: Partial<InventoryLot>): InventoryLot {
  return {
    id: 1,
    scryfall_id: 'lea-bolt',
    quantity: 1,
    finish: 'foil',
    condition: 'NM',
    location: null,
    card: {
      name: 'Lightning Bolt',
      set_code: 'lea',
      set_name: 'Limited Edition Alpha',
      collector_number: '161',
      image_uris: null,
    },
    ...overrides,
  }
}

afterEach(() => vi.clearAllMocks())

describe('InscribePage', () => {
  it('walks search → printing → inscribe and records the session entry', async () => {
    const user = userEvent.setup()
    autocompleteMock.mockResolvedValue(['Lightning Bolt'])
    searchMock.mockResolvedValue([
      printing({
        scryfall_id: 'lea-bolt',
        set_code: 'lea',
        set_name: 'Limited Edition Alpha',
      }),
      printing({
        scryfall_id: 'm10-bolt',
        set_code: 'm10',
        set_name: 'Magic 2010',
      }),
    ])
    inscribeMock.mockResolvedValue(lot({ id: 7, quantity: 2, finish: 'foil' }))

    render(<InscribePage />)

    // 1. Search by name and pick the autocomplete suggestion.
    await user.type(screen.getByLabelText('Card name'), 'bolt')
    const suggestion = await screen.findByRole('button', {
      name: 'Lightning Bolt',
    })
    await user.click(suggestion)

    // 2. The picker lists this card's printings; choose the LEA one.
    const leaOption = await screen.findByRole('button', {
      name: /Limited Edition Alpha/,
    })
    await user.click(leaOption)

    // 3. Fill the form: foil, quantity 2, and inscribe.
    await user.selectOptions(screen.getByLabelText('Finish'), 'foil')
    const qty = screen.getByLabelText('Quantity')
    await user.clear(qty)
    await user.type(qty, '2')
    await user.click(screen.getByRole('button', { name: 'Inscribe' }))

    // The POST carried the chosen printing + details.
    await waitFor(() =>
      expect(inscribeMock).toHaveBeenCalledWith({
        scryfall_id: 'lea-bolt',
        quantity: 2,
        finish: 'foil',
        condition: 'NM',
        location: null,
      }),
    )

    // The flow returned to the search box (fast multi-add)…
    expect(await screen.findByLabelText('Card name')).toBeInTheDocument()
    // …and the session list recorded the inscription.
    const session = screen.getByRole('complementary', {
      name: 'Inscribed this session',
    })
    expect(within(session).getByText(/2× Lightning Bolt/)).toBeInTheDocument()
  })

  it('keeps the form and shows an error when the inscription fails', async () => {
    const user = userEvent.setup()
    autocompleteMock.mockResolvedValue(['Sol Ring'])
    searchMock.mockResolvedValue([
      printing({ name: 'Sol Ring', scryfall_id: 'sol-1' }),
    ])
    inscribeMock.mockRejectedValue(new Error('boom'))

    render(<InscribePage />)
    await user.type(screen.getByLabelText('Card name'), 'sol')
    await user.click(await screen.findByRole('button', { name: 'Sol Ring' }))
    await user.click(
      await screen.findByRole('button', { name: /Limited Edition Alpha/ }),
    )
    await user.click(screen.getByRole('button', { name: 'Inscribe' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /could not be inscribed/i,
    )
    // Still on the form, not bounced to search.
    expect(screen.queryByLabelText('Card name')).not.toBeInTheDocument()
  })
})
