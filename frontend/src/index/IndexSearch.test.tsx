import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  Link,
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigationType,
} from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { folio } from '../test/fixtures'
import { renderWithQuery } from '../test/queryWrapper'
import { IndexSearch } from './IndexSearch'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return { ...actual, searchFolios: vi.fn() }
})

import { searchFolios } from '../api'

const searchMock = vi.mocked(searchFolios)

function named(...names: string[]) {
  return {
    results: names.map((name, i) =>
      folio({ scryfall_id: `id-${i}`, card: { name } }),
    ),
    total: names.length,
    limit: 20,
    offset: 0,
  }
}

/** Shows where the router is and how it got there. */
function Probe() {
  const { search } = useLocation()
  const how = useNavigationType()
  return (
    <output aria-label="Location">
      {search}|{how}
    </output>
  )
}

function renderSearch(entry = '/index') {
  return renderWithQuery(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route
          path="/index"
          element={
            <>
              <IndexSearch />
              <Probe />
              <Link to="/index">Clear filters</Link>
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  )
}

function location() {
  return screen.getByRole('status', { name: 'Location' })
}

afterEach(() => vi.clearAllMocks())

describe('IndexSearch', () => {
  it('writes the name to the URL after a pause, replacing the entry and dropping the page', async () => {
    const user = userEvent.setup()
    searchMock.mockResolvedValue(named())
    renderSearch('/index?finish=foil&page=3')

    await user.type(screen.getByLabelText('Search the Index'), 'sol')
    // The debounce has not fired between keystrokes.
    expect(location()).toHaveTextContent('?finish=foil&page=3|POP')

    await waitFor(() =>
      expect(location()).toHaveTextContent('?name=sol&finish=foil|REPLACE'),
    )
  })

  it('seeds the input from ?name=', () => {
    searchMock.mockResolvedValue(named())
    renderSearch('/index?name=bolt')
    expect(screen.getByLabelText('Search the Index')).toHaveValue('bolt')
  })

  it('takes the name back out of the URL when the input is emptied', async () => {
    const user = userEvent.setup()
    searchMock.mockResolvedValue(named())
    renderSearch('/index?name=bolt')

    await user.clear(screen.getByLabelText('Search the Index'))
    await waitFor(() => expect(location()).toHaveTextContent(/^\|REPLACE$/))
  })

  it('empties the input when the URL loses its name elsewhere', async () => {
    const user = userEvent.setup()
    searchMock.mockResolvedValue(named())
    renderSearch('/index?name=bolt')

    await user.click(screen.getByRole('link', { name: 'Clear filters' }))
    expect(screen.getByLabelText('Search the Index')).toHaveValue('')
    // The debounced value catching up must not write the old name back.
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(location()).toHaveTextContent(/^\|PUSH$/)
  })

  it('suggests owned card names, one each, at most eight', async () => {
    const user = userEvent.setup()
    searchMock.mockResolvedValue(
      named(
        'Lightning Bolt',
        'Lightning Bolt',
        'Lightning Helix',
        'Lightning Greaves',
        'Lightning Axe',
        'Lightning Strike',
        'Lightning Bolt',
        'Lightning Angel',
        'Lightning Mare',
        'Lightning Talons',
        'Lightning Visionary',
      ),
    )
    renderSearch()

    await user.type(screen.getByLabelText('Search the Index'), 'li')
    const list = await screen.findByRole('list', { name: 'Owned cards' })
    const options = list.querySelectorAll('.listbox__option')
    expect([...options].map((option) => option.textContent)).toEqual([
      'Lightning Bolt',
      'Lightning Helix',
      'Lightning Greaves',
      'Lightning Axe',
      'Lightning Strike',
      'Lightning Angel',
      'Lightning Mare',
      'Lightning Talons',
    ])
    expect(searchMock).toHaveBeenCalledWith(
      { name: 'li', limit: 20, sort: 'name' },
      expect.any(AbortSignal),
    )
  })

  it('waits for two characters before suggesting anything', async () => {
    const user = userEvent.setup()
    searchMock.mockResolvedValue(named('Sol Ring'))
    renderSearch()

    await user.type(screen.getByLabelText('Search the Index'), 's')
    await waitFor(() => expect(location()).toHaveTextContent('?name=s'))
    expect(searchMock).not.toHaveBeenCalled()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('hides the list when its only suggestion is what is already typed', async () => {
    const user = userEvent.setup()
    searchMock.mockResolvedValue(named('Sol Ring'))
    renderSearch()

    await user.type(screen.getByLabelText('Search the Index'), 'sol ring')
    await waitFor(() => expect(searchMock).toHaveBeenCalled())
    await waitFor(() => expect(location()).toHaveTextContent('?name=sol+ring'))
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('puts a picked suggestion in the input and the URL', async () => {
    const user = userEvent.setup()
    searchMock.mockResolvedValue(named('Sol Ring', 'Soldevi Digger'))
    renderSearch()

    await user.type(screen.getByLabelText('Search the Index'), 'sol')
    await user.click(await screen.findByRole('button', { name: 'Sol Ring' }))

    expect(screen.getByLabelText('Search the Index')).toHaveValue('Sol Ring')
    await waitFor(() =>
      expect(location()).toHaveTextContent('?name=Sol+Ring|REPLACE'),
    )
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    // The debounce catching up to the picked name must leave it in place.
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(location()).toHaveTextContent('?name=Sol+Ring|REPLACE')
    expect(screen.getByLabelText('Search the Index')).toHaveValue('Sol Ring')
  })

  it('moves between suggestions with the arrow keys', async () => {
    const user = userEvent.setup()
    searchMock.mockResolvedValue(named('Sol Ring', 'Soldevi Digger'))
    renderSearch()

    await user.type(screen.getByLabelText('Search the Index'), 'sol')
    const first = await screen.findByRole('button', { name: 'Sol Ring' })
    first.focus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('button', { name: 'Soldevi Digger' })).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(first).toHaveFocus()
  })

  it('keeps a trailing space typed before the URL caught up', async () => {
    const user = userEvent.setup()
    searchMock.mockResolvedValue(named())
    renderSearch()

    const input = screen.getByLabelText('Search the Index')
    await user.type(input, 'Lightning ')
    await waitFor(() => expect(location()).toHaveTextContent('?name=Lightning'))
    await user.type(input, 'Bolt')
    expect(input).toHaveValue('Lightning Bolt')
  })

  it('closes the suggestions on Escape', async () => {
    const user = userEvent.setup()
    searchMock.mockResolvedValue(named('Sol Ring', 'Soldevi Digger'))
    renderSearch()

    await user.type(screen.getByLabelText('Search the Index'), 'sol')
    await screen.findByRole('list', { name: 'Owned cards' })
    await user.keyboard('{Escape}')
    expect(
      screen.queryByRole('list', { name: 'Owned cards' }),
    ).not.toBeInTheDocument()
  })

  it('hides suggestions for the old text as soon as more is typed', async () => {
    const user = userEvent.setup()
    searchMock.mockResolvedValue(named('Lightning Bolt', 'Lightning Helix'))
    renderSearch()

    const input = screen.getByLabelText('Search the Index')
    await user.type(input, 'li')
    await screen.findByRole('list', { name: 'Owned cards' })
    // The debounce has not caught up to "lig", so the list on hand is for "li".
    await user.type(input, 'g')
    expect(
      screen.queryByRole('list', { name: 'Owned cards' }),
    ).not.toBeInTheDocument()
  })
})
