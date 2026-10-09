import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DeckSlot, DeckWithCards } from '../api'
import { deck, printing, slot } from '../test/fixtures'
import { renderWithQuery } from '../test/queryWrapper'
import { TomeEditorPage } from './TomeEditorPage'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return {
    ...actual,
    getDeck: vi.fn(),
    updateDeck: vi.fn(),
    deleteDeck: vi.fn(),
    addSlot: vi.fn(),
    updateSlot: vi.fn(),
    deleteSlot: vi.fn(),
    autocompleteNames: vi.fn(),
    searchPrintings: vi.fn(),
  }
})

import {
  addSlot,
  ApiError,
  autocompleteNames,
  deleteDeck,
  deleteSlot,
  getDeck,
  searchPrintings,
  updateDeck,
} from '../api'

const getMock = vi.mocked(getDeck)
const updateMock = vi.mocked(updateDeck)
const deleteMock = vi.mocked(deleteDeck)
const addMock = vi.mocked(addSlot)
const deleteSlotMock = vi.mocked(deleteSlot)
const autocompleteMock = vi.mocked(autocompleteNames)
const printingsMock = vi.mocked(searchPrintings)

function tome(
  cards: DeckSlot[] = [],
  overrides: Partial<DeckWithCards> = {},
): DeckWithCards {
  return { ...deck({ id: 4 }), cards, ...overrides }
}

const edgar = slot({
  id: 1,
  deck_id: 4,
  scryfall_id: 'edgar',
  board: 'commander',
  card: {
    name: 'Edgar Markov',
    type_line: 'Legendary Creature — Vampire Knight',
    cmc: 6,
  },
})
const bolt = slot({
  id: 2,
  deck_id: 4,
  board: 'main',
  quantity: 4,
  card: { name: 'Lightning Bolt', type_line: 'Instant', cmc: 1 },
})
const bloodghast = slot({
  id: 3,
  deck_id: 4,
  scryfall_id: 'bloodghast',
  board: 'main',
  quantity: 2,
  card: { name: 'Bloodghast', type_line: 'Creature — Vampire Spirit', cmc: 2 },
})
const swamp = slot({
  id: 4,
  deck_id: 4,
  scryfall_id: 'swamp',
  board: 'main',
  quantity: 30,
  card: { name: 'Swamp', type_line: 'Basic Land — Swamp', cmc: 0 },
})
const duress = slot({
  id: 5,
  deck_id: 4,
  scryfall_id: 'duress',
  board: 'sideboard',
  quantity: 3,
  card: { name: 'Duress', type_line: 'Sorcery', cmc: 1 },
})

function LocationProbe() {
  const { pathname, search } = useLocation()
  return <p data-testid="location">{pathname + search}</p>
}

function renderEditor(path = '/tomes/4') {
  return renderWithQuery(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/tomes" element={<p>The Tomes list</p>} />
        <Route
          path="/tomes/:deckId"
          element={
            <>
              <TomeEditorPage />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  )
}

/** The card names inside one board group, in the order shown. */
function namesIn(heading: string): string[] {
  const group = screen.getByRole('region', { name: heading })
  return within(group)
    .getAllByRole('listitem')
    .map((item) => item.querySelector('.tome-slot__name')!.textContent!)
}

afterEach(() => vi.clearAllMocks())

describe('TomeEditorPage', () => {
  it('shows the Tome with its boards in rank order and their copy counts', async () => {
    getMock.mockResolvedValue(tome([duress, bolt, edgar, swamp, bloodghast]))
    renderEditor()

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Edgar Markov' }),
    ).toBeInTheDocument()
    const groups = screen
      .getAllByRole('heading', { level: 3 })
      .map((h) => h.textContent)
    expect(groups).toEqual(['Commander · 1', 'Main · 36', 'Sideboard · 3'])
    expect(
      screen.getByRole('link', { name: 'Owned and needed' }),
    ).toHaveAttribute('href', '/tomes/4/breakdown')
  })

  it('sorts each board by card type by default', async () => {
    getMock.mockResolvedValue(tome([bolt, swamp, bloodghast]))
    renderEditor()

    await screen.findByRole('heading', { level: 1 })
    expect(namesIn('Main · 36')).toEqual([
      'Bloodghast',
      'Lightning Bolt',
      'Swamp',
    ])
  })

  it('sorts by mana value when the URL asks', async () => {
    getMock.mockResolvedValue(tome([bolt, swamp, bloodghast]))
    renderEditor('/tomes/4?sort=cmc')

    await screen.findByRole('heading', { level: 1 })
    expect(namesIn('Main · 36')).toEqual([
      'Swamp',
      'Lightning Bolt',
      'Bloodghast',
    ])
    expect(screen.getByLabelText('Sort by')).toHaveValue('cmc')
  })

  it('remembers a sort change in the URL', async () => {
    const user = userEvent.setup()
    getMock.mockResolvedValue(tome([bolt, swamp]))
    renderEditor()

    await user.selectOptions(await screen.findByLabelText('Sort by'), 'cmc')
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/tomes/4?sort=cmc',
    )
    expect(namesIn('Main · 34')).toEqual(['Swamp', 'Lightning Bolt'])

    await user.selectOptions(screen.getByLabelText('Sort by'), 'type')
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/tomes\/4$/)
  })

  it('shows the printing and finish on each row, and no stepper on the commander', async () => {
    getMock.mockResolvedValue(tome([edgar, bolt]))
    renderEditor()

    const row = (await screen.findByText('Lightning Bolt')).closest('li')!
    expect(row).toHaveTextContent('Limited Edition Alpha (LEA) · #161')
    expect(row).toHaveTextContent('nonfoil')
    expect(
      within(row).getByRole('button', {
        name: 'Increase quantity of Lightning Bolt',
      }),
    ).toBeInTheDocument()

    expect(
      screen.queryByRole('button', {
        name: 'Increase quantity of Edgar Markov',
      }),
    ).not.toBeInTheDocument()
  })

  it('invites a first card when the Tome is empty', async () => {
    getMock.mockResolvedValue(tome([]))
    renderEditor()
    expect(
      await screen.findByRole('heading', { name: 'No cards bound yet' }),
    ).toBeInTheDocument()
  })

  it('saves a status change at once', async () => {
    const user = userEvent.setup()
    getMock.mockResolvedValue(tome([]))
    updateMock.mockResolvedValue(tome([], { status: 'active' }))
    renderEditor()

    await user.selectOptions(await screen.findByLabelText('Status'), 'active')

    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith(4, { status: 'active' }),
    )
    expect(await screen.findByText('Saved.')).toBeInTheDocument()
    expect(screen.getByLabelText('Status')).toHaveValue('active')
  })

  it('saves a claims toggle at once', async () => {
    const user = userEvent.setup()
    getMock.mockResolvedValue(tome([]))
    updateMock.mockResolvedValue(tome([], { claims_cards: false }))
    renderEditor()

    const toggle = await screen.findByRole('checkbox', {
      name: 'This Tome claims its cards',
    })
    expect(toggle).toBeChecked()
    await user.click(toggle)

    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith(4, { claims_cards: false }),
    )
    expect(await screen.findByText('Saved.')).toBeInTheDocument()
  })

  it('puts the claim back and says why when turning it on is refused', async () => {
    const user = userEvent.setup()
    getMock.mockResolvedValue(tome([], { claims_cards: false }))
    updateMock.mockRejectedValue(
      new ApiError('Sorin already holds 2 copies.', 409),
    )
    renderEditor()

    const toggle = await screen.findByRole('checkbox', {
      name: 'This Tome claims its cards',
    })
    await user.click(toggle)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Sorin already holds 2 copies.',
    )
    expect(toggle).not.toBeChecked()
  })

  it('keeps a saved status when a later claims change is refused', async () => {
    const user = userEvent.setup()
    let finishRefetch: (value: DeckWithCards) => void = () => {}
    getMock
      .mockResolvedValueOnce(tome([]))
      .mockImplementationOnce(
        () => new Promise((resolve) => (finishRefetch = resolve)),
      )
      .mockResolvedValue(tome([], { status: 'active' }))
    updateMock
      .mockResolvedValueOnce(tome([], { status: 'active' }))
      .mockRejectedValueOnce(new ApiError('Sorin holds the copies.', 409))
    renderEditor()

    await user.selectOptions(await screen.findByLabelText('Status'), 'active')
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(2))
    const claims = screen.getByRole('checkbox', {
      name: 'This Tome claims its cards',
    })
    // The save is not done until the Tome is read back, so the controls hold.
    expect(claims).toBeDisabled()
    await user.click(claims)
    expect(updateMock).toHaveBeenCalledTimes(1)

    finishRefetch(tome([], { status: 'active' }))
    await screen.findByText('Saved.')
    await user.click(claims)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Sorin holds the copies.',
    )
    expect(screen.getByLabelText('Status')).toHaveValue('active')
    expect(claims).toBeChecked()
  })

  it('amends the name, format, notes, and changelog', async () => {
    const user = userEvent.setup()
    getMock.mockResolvedValue(tome([], { notes: 'old' }))
    updateMock.mockResolvedValue(tome([]))
    renderEditor()

    await user.click(await screen.findByText('Amend the Tome'))
    const name = screen.getByLabelText('Name')
    await user.clear(name)
    await user.type(name, 'Edgar, Vampire Patriarch')
    await user.clear(screen.getByLabelText('Format'))
    await user.clear(screen.getByLabelText('Notes'))
    await user.type(screen.getByLabelText('Changelog'), '+1 Bolt')
    await user.click(screen.getByRole('button', { name: 'Amend' }))

    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith(4, {
        name: 'Edgar, Vampire Patriarch',
        format: null,
        notes: null,
        changelog: '+1 Bolt',
      }),
    )
    expect(await screen.findByText('Amended.')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Notes'), 'x')
    expect(screen.queryByText('Amended.')).not.toBeInTheDocument()
  })

  it('unbinds the Tome only after confirming, then returns to the list', async () => {
    const user = userEvent.setup()
    getMock.mockResolvedValue(tome([]))
    deleteMock.mockResolvedValue(undefined)
    renderEditor()

    await user.click(
      await screen.findByRole('button', { name: 'Unbind this Tome' }),
    )
    expect(deleteMock).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Keep it' }))
    await user.click(screen.getByRole('button', { name: 'Unbind this Tome' }))
    await user.click(screen.getByRole('button', { name: 'Confirm unbinding' }))

    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith(4))
    expect(await screen.findByText('The Tomes list')).toBeInTheDocument()
    expect(getMock).toHaveBeenCalledTimes(1)
  })

  it('removes a slot without a confirm', async () => {
    const user = userEvent.setup()
    getMock.mockResolvedValue(tome([bolt]))
    deleteSlotMock.mockResolvedValue(undefined)
    renderEditor()

    await user.click(
      await screen.findByRole('button', { name: 'Remove Lightning Bolt' }),
    )
    await waitFor(() => expect(deleteSlotMock).toHaveBeenCalledWith(4, 2))
  })

  it('explains a Tome that does not exist', async () => {
    getMock.mockRejectedValue(new ApiError('No Tome with id 4.', 404))
    renderEditor()
    expect(
      await screen.findByRole('heading', { name: 'No such Tome' }),
    ).toBeInTheDocument()
  })
})

describe('TomeEditorPage, adding a card', () => {
  async function pickBolt(user: ReturnType<typeof userEvent.setup>) {
    autocompleteMock.mockResolvedValue(['Lightning Bolt'])
    printingsMock.mockResolvedValue({
      printings: [printing({ finishes: ['nonfoil', 'foil'] })],
      truncated: false,
    })
    await user.type(await screen.findByLabelText('Card name'), 'bolt')
    await user.click(
      await screen.findByRole('button', { name: 'Lightning Bolt' }),
    )
    await user.click(
      await screen.findByRole('button', { name: /Limited Edition Alpha/ }),
    )
  }

  it('adds the chosen printing to the chosen board and returns to search', async () => {
    const user = userEvent.setup()
    getMock.mockResolvedValue(tome([]))
    addMock.mockResolvedValue(bolt)
    renderEditor()

    await pickBolt(user)
    await user.selectOptions(screen.getByLabelText('Finish'), 'foil')
    await user.selectOptions(screen.getByLabelText('Board'), 'sideboard')
    const quantity = screen.getByLabelText('Quantity')
    await user.clear(quantity)
    await user.type(quantity, '3')
    await user.click(screen.getByRole('button', { name: 'Add to the Tome' }))

    await waitFor(() =>
      expect(addMock).toHaveBeenCalledWith(4, {
        scryfall_id: 'bolt-lea',
        finish: 'foil',
        board: 'sideboard',
        quantity: 3,
      }),
    )
    expect(await screen.findByLabelText('Card name')).toBeInTheDocument()
    expect(
      screen.getByText('Added 3× Lightning Bolt to Sideboard.'),
    ).toBeInTheDocument()
  })

  it('offers the boards in rank order and defaults to Main', async () => {
    const user = userEvent.setup()
    getMock.mockResolvedValue(tome([]))
    renderEditor()

    await pickBolt(user)
    const board = screen.getByLabelText('Board')
    expect(board).toHaveValue('main')
    expect(
      within(board)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Commander', 'Companion', 'Main', 'Sideboard', 'Maybeboard'])
  })

  it('fixes the quantity at one for a commander', async () => {
    const user = userEvent.setup()
    getMock.mockResolvedValue(tome([]))
    addMock.mockResolvedValue(edgar)
    renderEditor()

    await pickBolt(user)
    const quantity = screen.getByLabelText('Quantity')
    await user.clear(quantity)
    await user.type(quantity, '4')
    await user.selectOptions(screen.getByLabelText('Board'), 'commander')
    expect(quantity).toBeDisabled()
    expect(quantity).toHaveValue(1)
    await user.click(screen.getByRole('button', { name: 'Add to the Tome' }))

    await waitFor(() =>
      expect(addMock).toHaveBeenCalledWith(
        4,
        expect.objectContaining({ board: 'commander', quantity: 1 }),
      ),
    )
  })

  it('shows a reservation refusal, whose message names the holders', async () => {
    const user = userEvent.setup()
    getMock.mockResolvedValue(tome([]))
    const message = 'Other Tomes hold all 3 copies you own.'
    addMock.mockRejectedValue(
      new ApiError(message, 409, message, {
        message,
        holders: [
          { deck_id: 1, name: 'Olivia', quantity: 2 },
          { deck_id: 2, name: 'Sorin', quantity: 1 },
        ],
      }),
    )
    renderEditor()

    await pickBolt(user)
    await user.click(screen.getByRole('button', { name: 'Add to the Tome' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(message)
    // The form stays up so the user can change board or quantity and retry.
    expect(
      screen.getByRole('button', { name: 'Add to the Tome' }),
    ).toBeInTheDocument()
  })

  it('shows a singleton refusal', async () => {
    const user = userEvent.setup()
    getMock.mockResolvedValue(tome([]))
    addMock.mockRejectedValue(
      new ApiError('A commander slot holds one copy.', 409),
    )
    renderEditor()

    await pickBolt(user)
    await user.click(screen.getByRole('button', { name: 'Add to the Tome' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('A commander slot holds one copy.')
  })

  it('refuses a quantity below one without calling the API', async () => {
    const user = userEvent.setup()
    getMock.mockResolvedValue(tome([]))
    renderEditor()

    await pickBolt(user)
    await user.clear(screen.getByLabelText('Quantity'))
    await user.click(screen.getByRole('button', { name: 'Add to the Tome' }))

    expect(addMock).not.toHaveBeenCalled()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A slot holds at least one copy.',
    )
  })
})
