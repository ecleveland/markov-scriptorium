import { screen, waitFor, within } from '@testing-library/react'
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
  it('lists each Tome with its format, status, claim, and copy count', async () => {
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

    const edgar = (
      await screen.findByRole('link', { name: 'Edgar Markov' })
    ).closest('li')!
    expect(edgar).toHaveTextContent('commander')
    expect(within(edgar).getByText('Active')).toHaveClass('tag')
    expect(edgar).toHaveTextContent('100 cards')
    expect(edgar).toHaveTextContent('Claims its cards')
    expect(screen.getByRole('link', { name: 'Edgar Markov' })).toHaveAttribute(
      'href',
      '/tomes/2',
    )

    const brew = screen.getByRole('link', { name: 'Burn brew' }).closest('li')!
    expect(within(brew).getByText('Playtest')).toBeInTheDocument()
    expect(brew).toHaveTextContent('1 card')
    expect(brew).toHaveTextContent('References only')
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
})
