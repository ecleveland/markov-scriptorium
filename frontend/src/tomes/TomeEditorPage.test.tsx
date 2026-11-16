import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useQuery } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DeckSlot, DeckWithCards } from '../api'
import { inventoryKeys } from '../catalog/queryKeys'
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
  updateSlot,
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

/** A live read of the Catalog, so a test can see whether it was refetched. */
function InventoryProbe({ read }: { read: () => Promise<unknown> }) {
  useQuery({ queryKey: inventoryKeys.all, queryFn: read })
  return null
}

function renderEditor(
  path = '/tomes/4',
  readInventory?: () => Promise<unknown>,
) {
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
              {readInventory && <InventoryProbe read={readInventory} />}
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  )
}

/** The card names inside one board group, in the order shown. */
function namesIn(board: string): string[] {
  const group = screen.getByRole('region', { name: board })
  return within(group)
    .getAllByRole('listitem')
    .map((item) => item.querySelector('.ledger__name')!.textContent!)
}

afterEach(() => vi.clearAllMocks())

describe('TomeEditorPage', () => {
  it('shows the Tome with its boards in rank order and their copy counts', async () => {
    getMock.mockResolvedValue(tome([duress, bolt, edgar, swamp, bloodghast]))
    renderEditor()

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Edgar Markov' }),
    ).toBeInTheDocument()
    const headings = screen.getAllByRole('heading', { level: 3 })
    expect(headings.map((h) => h.textContent)).toEqual([
      'Commander',
      'Main',
      'Sideboard',
    ])
    for (const heading of headings) expect(heading).toHaveClass('opening')

    const main = screen.getByRole('region', { name: 'Main' })
    const count = main.querySelector('.tome-board__count')!
    expect(count.querySelector('.ledger__figure')).toHaveTextContent(/^36$/)
    expect(count).toHaveTextContent('36 cards')
    expect(
      screen
        .getByRole('region', { name: 'Commander' })
        .querySelector('.tome-board__count'),
    ).toHaveTextContent('1 card')
    expect(
      screen.getByRole('link', { name: 'Owned and needed' }),
    ).toHaveAttribute('href', '/tomes/4/breakdown')
  })

  it('lists each board as a ledger, numbered on across the whole Tome', async () => {
    getMock.mockResolvedValue(tome([duress, bolt, edgar, swamp, bloodghast]))
    renderEditor()

    await screen.findByRole('heading', { level: 1 })
    expect(screen.getByRole('list', { name: 'Main cards' }).tagName).toBe('OL')
    const numbers = [...document.querySelectorAll('.ledger__number')].map(
      (n) => n.textContent,
    )
    expect(numbers).toEqual(['1', '2', '3', '4', '5'])
    expect(
      within(screen.getByRole('region', { name: 'Sideboard' }))
        .getByRole('listitem')
        .querySelector('.ledger__number'),
    ).toHaveTextContent('5')
  })

  it('links back to the Tomes without an arrow glyph', async () => {
    getMock.mockResolvedValue(tome([]))
    renderEditor()
    expect(
      await screen.findByRole('link', { name: 'Back to the Tomes' }),
    ).toHaveAttribute('href', '/tomes')
  })

  it('tags the header with the format, before the breakdown link', async () => {
    getMock.mockResolvedValue(tome([]))
    renderEditor()
    const heading = await screen.findByRole('heading', {
      level: 1,
      name: 'Edgar Markov',
    })
    const header = heading.closest('.page-header') as HTMLElement
    const tag = within(header).getByText('commander')
    expect(tag).toHaveClass('tag', 'tag--neutral')
    const link = within(header).getByRole('link', { name: 'Owned and needed' })
    expect(
      tag.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('puts no tag in the header when the Tome has no format', async () => {
    getMock.mockResolvedValue(tome([], { format: null }))
    renderEditor()
    const heading = await screen.findByRole('heading', {
      level: 1,
      name: 'Edgar Markov',
    })
    const header = heading.closest('.page-header') as HTMLElement
    expect(header.querySelector('.tag')).toBeNull()
    expect(within(header).queryByText('Tome')).toBeNull()
  })

  it('sorts each board by card type by default', async () => {
    getMock.mockResolvedValue(tome([bolt, swamp, bloodghast]))
    renderEditor()

    await screen.findByRole('heading', { level: 1 })
    expect(namesIn('Main')).toEqual(['Bloodghast', 'Lightning Bolt', 'Swamp'])
    expect(screen.getByRole('button', { name: 'by type' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(
      screen.getByRole('button', { name: 'by mana value' }),
    ).toHaveAttribute('aria-pressed', 'false')
  })

  it('sorts by mana value when the URL asks', async () => {
    getMock.mockResolvedValue(tome([bolt, swamp, bloodghast]))
    renderEditor('/tomes/4?sort=cmc')

    await screen.findByRole('heading', { level: 1 })
    expect(namesIn('Main')).toEqual(['Swamp', 'Lightning Bolt', 'Bloodghast'])
    expect(
      screen.getByRole('button', { name: 'by mana value' }),
    ).toHaveAttribute('aria-pressed', 'true')
  })

  it('remembers a sort change in the URL', async () => {
    const user = userEvent.setup()
    getMock.mockResolvedValue(tome([bolt, swamp]))
    renderEditor()

    const byManaValue = await screen.findByRole('button', {
      name: 'by mana value',
    })
    expect(byManaValue).toHaveClass('tome-cards__toggle')
    await user.click(byManaValue)
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/tomes/4?sort=cmc',
    )
    expect(namesIn('Main')).toEqual(['Swamp', 'Lightning Bolt'])

    await user.click(screen.getByRole('button', { name: 'by type' }))
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/tomes\/4$/)
    expect(namesIn('Main')).toEqual(['Lightning Bolt', 'Swamp'])
  })

  it('shows the printing on each row, and no stepper on the commander', async () => {
    getMock.mockResolvedValue(tome([edgar, bolt]))
    renderEditor()

    const row = (await screen.findByText('Lightning Bolt')).closest('li')!
    expect(row.querySelector('.ledger__where')).toHaveTextContent(
      /^Limited Edition Alpha, no\. 161\.$/,
    )
    // Nonfoil is the plain case and says nothing.
    expect(row).not.toHaveTextContent('foil')
    expect(
      within(row).getByRole('button', {
        name: 'Increase quantity of Lightning Bolt',
      }),
    ).toBeInTheDocument()

    const commander = screen
      .getByText('Edgar Markov', {
        selector: '.ledger__name',
      })
      .closest('li')!
    expect(
      within(commander).queryByRole('button', {
        name: 'Increase quantity of Edgar Markov',
      }),
    ).not.toBeInTheDocument()
    expect(commander.querySelector('.ledger__count')).toHaveTextContent(
      '1 copy',
    )
    expect(
      commander.querySelector('.ledger__count .ledger__figure'),
    ).toHaveTextContent(/^1$/)
  })

  it('names the finish of a foil slot after the card', async () => {
    getMock.mockResolvedValue(
      tome([
        { ...bolt, finish: 'foil' },
        { ...bloodghast, finish: 'etched' },
      ]),
    )
    renderEditor()

    const row = (await screen.findByText('Lightning Bolt')).closest('li')!
    const name = row.querySelector('.ledger__name')!
    expect(name).toHaveTextContent(/^Lightning Bolt foil$/)
    expect(within(row).getByText('foil')).toHaveClass('finish-word')
    expect(screen.getByText('etched')).toHaveClass('finish-word')
  })

  it('keeps the Remove button under the stepper on each row', async () => {
    getMock.mockResolvedValue(tome([bolt]))
    renderEditor()

    const remove = await screen.findByRole('button', {
      name: 'Remove Lightning Bolt',
    })
    expect(remove).toHaveTextContent('Remove')
    expect(remove.closest('.ledger__note')).not.toBeNull()
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

  it('keeps the editor and its unsaved edits when a refresh fails', async () => {
    const user = userEvent.setup()
    getMock
      .mockResolvedValueOnce(tome([bolt]))
      .mockRejectedValue(new ApiError('The scriptorium is closed.', 503))
    vi.mocked(updateSlot).mockResolvedValue({ ...bolt, quantity: 5 })
    renderEditor()

    await user.click(await screen.findByText('Amend the Tome'))
    await user.type(screen.getByLabelText('Changelog'), 'draft')
    await user.click(
      screen.getByRole('button', {
        name: 'Increase quantity of Lightning Bolt',
      }),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The Tome could not be refreshed. The scriptorium is closed.',
    )
    expect(
      screen.getByRole('heading', { level: 1, name: 'Edgar Markov' }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Changelog')).toHaveValue('draft')
  })

  it('explains a Tome that does not exist', async () => {
    getMock.mockRejectedValue(new ApiError('No Tome with id 4.', 404))
    renderEditor()
    expect(
      await screen.findByRole('heading', { name: 'No such Tome' }),
    ).toBeInTheDocument()
  })

  it('stays on the editor when unbinding is refused', async () => {
    const user = userEvent.setup()
    getMock.mockResolvedValue(tome([]))
    deleteMock.mockRejectedValue(new ApiError('The scriptorium refused', 500))
    renderEditor()

    await user.click(
      await screen.findByRole('button', { name: 'Unbind this Tome' }),
    )
    await user.click(screen.getByRole('button', { name: 'Confirm unbinding' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The scriptorium refused',
    )
    expect(
      screen.getByRole('heading', { level: 1, name: 'Edgar Markov' }),
    ).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/tomes\/4$/)
  })

  it('explains a Tome that could not be read', async () => {
    getMock.mockRejectedValue(new ApiError('The archive is on fire', 500))
    renderEditor()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The Tome could not be read.',
    )
  })

  it('refuses a blank name on amend', async () => {
    const user = userEvent.setup()
    getMock.mockResolvedValue(tome([]))
    renderEditor()

    await user.click(await screen.findByText('Amend the Tome'))
    await user.clear(screen.getByLabelText('Name'))
    await user.click(screen.getByRole('button', { name: 'Amend' }))

    expect(await screen.findByText('A Tome needs a name.')).toBeInTheDocument()
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('shows the reason when removing a slot is refused', async () => {
    const user = userEvent.setup()
    getMock.mockResolvedValue(tome([bolt]))
    deleteSlotMock.mockRejectedValue(new ApiError('The slot is sealed.', 500))
    renderEditor()

    await user.click(
      await screen.findByRole('button', { name: 'Remove Lightning Bolt' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The slot is sealed.',
    )
  })

  it('says there is no such Tome for an id that is not a number', async () => {
    renderEditor('/tomes/abc')
    expect(
      await screen.findByRole('heading', { name: 'No such Tome' }),
    ).toBeInTheDocument()
    expect(getMock).not.toHaveBeenCalled()
  })

  it("refetches the Catalog's reservations after a claims change", async () => {
    const user = userEvent.setup()
    getMock.mockResolvedValue(tome([]))
    updateMock.mockResolvedValue(tome([], { claims_cards: false }))
    const readInventory = vi.fn().mockResolvedValue([])
    renderEditor('/tomes/4', readInventory)

    const toggle = await screen.findByRole('checkbox', {
      name: 'This Tome claims its cards',
    })
    await waitFor(() => expect(readInventory).toHaveBeenCalledTimes(1))
    await user.click(toggle)

    await screen.findByText('Saved.')
    expect(readInventory).toHaveBeenCalledTimes(2)
  })

  it('leaves the Catalog alone after a status-only change', async () => {
    const user = userEvent.setup()
    getMock.mockResolvedValue(tome([]))
    updateMock.mockResolvedValue(tome([], { status: 'active' }))
    const readInventory = vi.fn().mockResolvedValue([])
    renderEditor('/tomes/4', readInventory)

    await waitFor(() => expect(readInventory).toHaveBeenCalledTimes(1))
    await user.selectOptions(await screen.findByLabelText('Status'), 'active')

    await screen.findByText('Saved.')
    expect(readInventory).toHaveBeenCalledTimes(1)
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

  it('sets the add flow in a ruled section and names the chosen printing in prose', async () => {
    const user = userEvent.setup()
    getMock.mockResolvedValue(tome([]))
    renderEditor()

    const section = await screen.findByRole('region', { name: 'Add a card' })
    expect(section).toHaveClass('tome-add')
    expect(section).not.toHaveClass('panel')
    expect(
      within(section).getByRole('heading', { level: 2, name: 'Add a card' }),
    ).toHaveClass('opening')

    await pickBolt(user)
    expect(
      within(section).getByRole('heading', {
        level: 2,
        name: 'Lightning Bolt',
      }),
    ).toBeInTheDocument()
    expect(
      within(section).getByText('Limited Edition Alpha, no. 161.'),
    ).toHaveClass('slot-form__printing')
    expect(section.querySelector('.slot-form__fields')).not.toHaveClass('panel')
    expect(
      within(section).getByRole('button', { name: 'Change printing' }),
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
    addMock.mockRejectedValue(new ApiError(message, 409, message))
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
