import { focusManager } from '@tanstack/react-query'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { deck } from '../test/fixtures'
import { renderWithQuery } from '../test/queryWrapper'
import { TomesPage } from './TomesPage'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return { ...actual, listDecks: vi.fn(), createDeck: vi.fn() }
})

import { ApiError, createDeck, listDecks } from '../api'

const listMock = vi.mocked(listDecks)
const createMock = vi.mocked(createDeck)

function EditorStub() {
  const { deckId } = useParams()
  return <p>Editor for Tome {deckId}</p>
}

function renderPage() {
  return renderWithQuery(
    <MemoryRouter initialEntries={['/tomes']}>
      <Routes>
        <Route path="/tomes" element={<TomesPage />} />
        <Route path="/tomes/:deckId" element={<EditorStub />} />
      </Routes>
    </MemoryRouter>,
  )
}

afterEach(() => vi.clearAllMocks())

describe('TomesPage', () => {
  it('explains a list that could not be read', async () => {
    listMock.mockRejectedValue(new ApiError('The archive is on fire', 500))
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The Tomes could not be read.',
    )
  })

  it('shelves each Tome as a spine with its format, count, and status', async () => {
    listMock.mockResolvedValue([
      deck({
        id: 2,
        name: 'Edgar Markov',
        format: 'commander',
        status: 'active',
        card_count: 100,
      }),
      deck({
        id: 1,
        name: 'Burn brew',
        format: null,
        status: 'playtest',
        claims_cards: false,
        card_count: 1,
      }),
    ])
    renderPage()

    const shelf = await screen.findByRole('list', { name: 'Tomes' })
    expect(shelf).toHaveClass('shelf')

    const edgar = within(shelf).getByRole('link', { name: /^Edgar Markov/ })
    expect(edgar).toHaveClass('spine')
    expect(edgar).toHaveAttribute('href', '/tomes/2')
    expect(edgar.querySelector('.spine__name')).toHaveTextContent(
      'Edgar Markov',
    )
    expect(edgar.querySelector('.spine__meta')).toHaveTextContent(
      'commander, 100 cards',
    )
    expect(edgar.querySelector('.spine__status')).toHaveTextContent(/^Active$/)
    expect(edgar.querySelector('.tag')).toBeNull()

    const brew = within(shelf).getByRole('link', { name: /^Burn brew/ })
    expect(brew.querySelector('.spine__meta')).toHaveTextContent(
      'no format, one card',
    )
    expect(brew.querySelector('.spine__status')).toHaveTextContent(
      'Playtest, references only',
    )
  })

  it('colours the edge of each spine by status and format', async () => {
    listMock.mockResolvedValue([
      deck({ id: 1, name: 'Edgar Markov', status: 'active' }),
      deck({ id: 2, name: 'Vintage cube', format: 'cube' }),
      deck({ id: 3, name: 'Burn brew', format: 'modern' }),
    ])
    renderPage()

    expect(
      await screen.findByRole('link', { name: /^Edgar Markov/ }),
    ).toHaveAttribute('data-edge', 'gold')
    expect(screen.getByRole('link', { name: /^Vintage cube/ })).toHaveAttribute(
      'data-edge',
      'moss',
    )
    expect(screen.getByRole('link', { name: /^Burn brew/ })).toHaveAttribute(
      'data-edge',
      'oxblood',
    )
  })

  it('binds a new Tome under a rubricated heading in a ruled section', async () => {
    listMock.mockResolvedValue([])
    renderPage()

    const form = await screen.findByRole('region', { name: 'Bind a new Tome' })
    expect(form).toHaveClass('tome-create')
    expect(form).not.toHaveClass('panel')
    expect(
      within(form).getByRole('heading', { level: 2, name: 'Bind a new Tome' }),
    ).toHaveClass('opening')
  })

  it('says so when no Tome is bound yet', async () => {
    listMock.mockResolvedValue([])
    renderPage()
    expect(
      await screen.findByRole('heading', { name: 'No Tomes bound yet' }),
    ).toBeInTheDocument()
  })

  it('binds a Tome and opens its editor', async () => {
    const user = userEvent.setup()
    listMock.mockResolvedValue([])
    createMock.mockResolvedValue(deck({ id: 7, name: 'Edgar Markov' }))
    renderPage()

    await user.type(await screen.findByLabelText('Name'), 'Edgar Markov')
    await user.type(screen.getByLabelText('Format'), 'commander')
    await user.click(
      screen.getByRole('checkbox', { name: 'This Tome claims its cards' }),
    )
    await user.click(screen.getByRole('button', { name: 'Bind the Tome' }))

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith({
        name: 'Edgar Markov',
        format: 'commander',
        claims_cards: false,
      }),
    )
    expect(await screen.findByText('Editor for Tome 7')).toBeInTheDocument()
  })

  it('claims cards by default and sends a blank format as null', async () => {
    const user = userEvent.setup()
    listMock.mockResolvedValue([])
    createMock.mockResolvedValue(deck({ id: 3 }))
    renderPage()

    await user.type(await screen.findByLabelText('Name'), 'Brew')
    await user.click(screen.getByRole('button', { name: 'Bind the Tome' }))

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith({
        name: 'Brew',
        format: null,
        claims_cards: true,
      }),
    )
  })

  it('refuses a blank name without calling the API', async () => {
    const user = userEvent.setup()
    listMock.mockResolvedValue([])
    renderPage()

    await user.type(await screen.findByLabelText('Name'), '   ')
    await user.click(screen.getByRole('button', { name: 'Bind the Tome' }))

    expect(createMock).not.toHaveBeenCalled()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A Tome needs a name.',
    )
  })

  it('shows why the bind failed', async () => {
    const user = userEvent.setup()
    listMock.mockResolvedValue([])
    createMock.mockRejectedValue(
      new ApiError('format must be a lowercase format key', 422),
    )
    renderPage()

    await user.type(await screen.findByLabelText('Name'), 'Brew')
    await user.click(screen.getByRole('button', { name: 'Bind the Tome' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'format must be a lowercase format key',
    )
  })

  it('keeps the list on screen when a refresh fails', async () => {
    listMock
      .mockResolvedValueOnce([deck({ id: 2, name: 'Edgar Markov' })])
      .mockRejectedValue(new ApiError('The scriptorium is closed.', 503))
    renderPage()
    await screen.findByRole('link', { name: /^Edgar Markov/ })

    // Regaining focus refetches the stale list, and this time it fails.
    act(() => {
      focusManager.setFocused(false)
      focusManager.setFocused(true)
    })

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The Tomes could not be refreshed. The scriptorium is closed.',
    )
    expect(
      screen.getByRole('link', { name: /^Edgar Markov/ }),
    ).toBeInTheDocument()
    focusManager.setFocused(undefined)
  })
})
