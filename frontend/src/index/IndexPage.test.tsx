import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { facets, folio } from '../test/fixtures'
import { renderWithQuery } from '../test/queryWrapper'
import { IndexPage } from './IndexPage'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return { ...actual, searchFolios: vi.fn(), listFacets: vi.fn() }
})

import {
  ApiError,
  INDEX_PAGE_SIZE,
  listFacets,
  searchFolios,
  type SearchFolio,
} from '../api'

const searchMock = vi.mocked(searchFolios)

function page(results: SearchFolio[], total = results.length, offset = 0) {
  return { results, total, limit: INDEX_PAGE_SIZE, offset }
}

const SOL_RING = folio({
  scryfall_id: 'sol-ring-c21',
  finish: 'foil',
  quantity: 4,
  lots: 2,
  conditions: ['NM', 'LP'],
  locations: ['Red binder', 'Trade box'],
  tags: ['edh', 'trade'],
  reserved: 2,
  available: 2,
  card: {
    name: 'Sol Ring',
    set_code: 'c21',
    set_name: 'Commander 2021',
    collector_number: '263',
    rarity: 'uncommon',
  },
})

function Where() {
  const { search } = useLocation()
  return <output aria-label="Index URL">{search}</output>
}

function Opened() {
  const { pathname, state } = useLocation()
  return (
    <p>
      Opened {pathname} from{' '}
      {(state as { indexSearch?: string } | null)?.indexSearch}
    </p>
  )
}

function renderIndex(entry = '/index') {
  return renderWithQuery(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route
          path="/index"
          element={
            <>
              <IndexPage />
              <Where />
            </>
          }
        />
        <Route path="/index/:scryfallId" element={<Opened />} />
      </Routes>
    </MemoryRouter>,
  )
}

function where() {
  return screen.getByRole('status', { name: 'Index URL' })
}

beforeEach(() => {
  vi.mocked(listFacets).mockResolvedValue(facets())
})

afterEach(() => vi.clearAllMocks())

describe('IndexPage', () => {
  it('opens on "The Index" heading', async () => {
    searchMock.mockResolvedValue(page([folio()]))
    renderIndex()
    expect(
      screen.getByRole('heading', { level: 1, name: 'The Index' }),
    ).toBeInTheDocument()
  })

  it('shows a tile per folio with its printing, finish, copies and Volumes', async () => {
    searchMock.mockResolvedValue(page([folio(), SOL_RING]))
    renderIndex()

    const grid = await screen.findByRole('list', { name: 'Folios' })
    const tiles = within(grid).getAllByRole('listitem')
    expect(tiles).toHaveLength(2)

    const bolt = within(tiles[0])
    expect(bolt.getByRole('link', { name: 'Lightning Bolt' })).toHaveAttribute(
      'href',
      '/index/bolt-lea',
    )
    expect(
      bolt.getByText('Limited Edition Alpha (LEA) · #161'),
    ).toBeInTheDocument()
    expect(bolt.getByText('nonfoil')).toHaveClass('tag')
    expect(bolt.getByText('×1')).toBeInTheDocument()
    expect(bolt.getByText('unshelved')).toBeInTheDocument()
    expect(bolt.queryByText(/in Tomes/)).not.toBeInTheDocument()

    const ring = within(tiles[1])
    expect(ring.getByText('foil')).toHaveClass('tag')
    expect(ring.getByText('×4')).toBeInTheDocument()
    expect(ring.getByText('4 copies')).toBeInTheDocument()
    expect(ring.getByText('2 of 4 in Tomes · 2 free')).toBeInTheDocument()
    expect(ring.getByText('Red binder, Trade box')).toBeInTheDocument()
    expect(
      ring.getByRole('img', { name: 'Sol Ring (no image in the catalog)' }),
    ).toBeInTheDocument()

    expect(screen.getByText('Showing 1 to 2 of 2 folios')).toBeInTheDocument()
  })

  it('hands the open folio the Index URL, so its back link returns there', async () => {
    const user = userEvent.setup()
    searchMock.mockResolvedValue(page([folio()]))
    renderIndex('/index?finish=nonfoil')

    await user.click(
      await screen.findByRole('link', { name: 'Lightning Bolt' }),
    )
    expect(
      screen.getByText('Opened /index/bolt-lea from ?finish=nonfoil'),
    ).toBeInTheDocument()
  })

  it('sends the filters, sort and page in the URL to the search', async () => {
    searchMock.mockResolvedValue(page([folio()], 60, INDEX_PAGE_SIZE))
    renderIndex('/index?finish=foil&set=lea&color_identity=R&sort=name&page=2')

    await waitFor(() =>
      expect(searchMock).toHaveBeenCalledWith(
        {
          set: ['lea'],
          color_identity: ['R'],
          finish: ['foil'],
          sort: 'name',
          order: 'asc',
          limit: INDEX_PAGE_SIZE,
          offset: INDEX_PAGE_SIZE,
        },
        expect.any(AbortSignal),
      ),
    )
  })

  it('rewrites the URL when a facet is checked, and goes back to page one', async () => {
    const user = userEvent.setup()
    searchMock.mockResolvedValue(page([folio()], 60, INDEX_PAGE_SIZE))
    renderIndex('/index?view=list&page=2')

    await user.click(await screen.findByRole('checkbox', { name: 'foil' }))
    expect(where()).toHaveTextContent(/^\?finish=foil&view=list$/)
    await waitFor(() =>
      expect(searchMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ finish: ['foil'], offset: 0 }),
        expect.any(AbortSignal),
      ),
    )
  })

  it('sorts by the picked key and flips the order with the button', async () => {
    const user = userEvent.setup()
    searchMock.mockResolvedValue(page([folio()], 60, INDEX_PAGE_SIZE))
    renderIndex('/index?page=2')

    const order = await screen.findByRole('button', { name: 'Newest first' })
    await user.click(order)
    expect(where()).toHaveTextContent('?order=asc')
    expect(
      screen.getByRole('button', { name: 'Oldest first' }),
    ).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Sort by'), 'Name')
    expect(where()).toHaveTextContent('?sort=name')
    await user.click(screen.getByRole('button', { name: 'A to Z' }))
    expect(where()).toHaveTextContent('?sort=name&order=desc')
    expect(screen.getByRole('button', { name: 'Z to A' })).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Sort by'), 'Copies')
    expect(
      screen.getByRole('button', { name: 'Most copies' }),
    ).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Sort by'), 'Set')
    expect(screen.getByRole('button', { name: 'A to Z' })).toBeInTheDocument()

    await waitFor(() =>
      expect(searchMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ sort: 'set', order: 'asc', offset: 0 }),
        expect.any(AbortSignal),
      ),
    )
    // No price sort until the search has a price key (ADR 0021).
    expect(
      within(screen.getByLabelText('Sort by')).getAllByRole('option'),
    ).toHaveLength(4)
  })

  it('swaps the grid for a table and keeps the page', async () => {
    const user = userEvent.setup()
    searchMock.mockResolvedValue(page([SOL_RING], 60, INDEX_PAGE_SIZE))
    renderIndex('/index?finish=foil&page=2')

    const grid = await screen.findByRole('button', { name: 'Grid' })
    expect(grid).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'List' }))

    expect(where()).toHaveTextContent('?finish=foil&view=list&page=2')
    expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(grid).toHaveAttribute('aria-pressed', 'false')
    expect(
      screen.queryByRole('list', { name: 'Folios' }),
    ).not.toBeInTheDocument()

    const region = screen.getByRole('region', { name: 'Index table' })
    expect(region.tabIndex).toBe(0)
    const table = within(region).getByRole('table')
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual([
      'Art',
      'Card',
      'Finish',
      'Copies',
      'Conditions',
      'Volumes',
      'Tags',
    ])
    const row = within(table).getAllByRole('row')[1]
    expect(within(row).getByRole('link', { name: 'Sol Ring' })).toHaveAttribute(
      'href',
      '/index/sol-ring-c21',
    )
    expect(row).toHaveTextContent('Commander 2021 (C21) · #263')
    expect(row).toHaveTextContent('2 of 4 in Tomes · 2 free')
    expect(row).toHaveTextContent('NM, LP')
    expect(row).toHaveTextContent('Red binder, Trade box')
    expect(row).toHaveTextContent('edh, trade')

    await user.click(screen.getByRole('button', { name: 'Grid' }))
    expect(where()).toHaveTextContent('?finish=foil&page=2')
  })

  it('marks an unshelved folio in the table too', async () => {
    searchMock.mockResolvedValue(page([folio()]))
    renderIndex('/index?view=list')
    const table = await screen.findByRole('table')
    expect(within(table).getByText('unshelved')).toBeInTheDocument()
  })

  it('pages forward and back by the Index page size', async () => {
    const user = userEvent.setup()
    searchMock.mockResolvedValue(page([folio()], 60))
    renderIndex('/index?finish=foil')

    expect(
      await screen.findByRole('button', { name: 'Previous' }),
    ).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(where()).toHaveTextContent('?finish=foil&page=2')
    await waitFor(() =>
      expect(searchMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ offset: INDEX_PAGE_SIZE }),
        expect.any(AbortSignal),
      ),
    )

    await user.click(screen.getByRole('button', { name: 'Previous' }))
    expect(where()).toHaveTextContent(/^\?finish=foil$/)
  })

  it('disables Next on the last page', async () => {
    searchMock.mockResolvedValue(page([folio()], 1))
    renderIndex()
    expect(await screen.findByRole('button', { name: 'Next' })).toBeDisabled()
  })

  it('points an empty collection at the three ways to fill it', async () => {
    searchMock.mockResolvedValue(page([], 0))
    renderIndex('/index?sort=name&view=list')

    expect(
      await screen.findByRole('heading', { name: 'Nothing inscribed yet' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Inscribe' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'decklist' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'CSV export' })).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('says nothing matches when filters empty the result, and clears them', async () => {
    const user = userEvent.setup()
    searchMock.mockResolvedValueOnce(page([], 0))
    searchMock.mockResolvedValue(page([folio()]))
    renderIndex('/index?finish=etched&view=list')

    expect(
      await screen.findByText('Nothing in the Index matches these filters.'),
    ).toHaveAttribute('role', 'status')
    expect(
      screen.queryByRole('heading', { name: 'Nothing inscribed yet' }),
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(where()).toBeEmptyDOMElement()
    expect(
      await screen.findByRole('link', { name: 'Lightning Bolt' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'etched' })).not.toBeChecked()
  })

  it('surfaces a read failure as an alert', async () => {
    searchMock.mockRejectedValue(new ApiError('database is locked', 500))
    renderIndex()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'database is locked',
    )
  })

  it('keeps the shown range tied to the rows on screen while the next page loads', async () => {
    const user = userEvent.setup()
    searchMock.mockResolvedValueOnce(page([folio()], 30))
    searchMock.mockReturnValueOnce(new Promise(() => {}))
    renderIndex()

    await screen.findByText('Showing 1 to 1 of 30 folios')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('Showing 1 to 1 of 30 folios')).toBeInTheDocument()
  })

  it('lands on the last real page when the result shrank under it', async () => {
    searchMock.mockResolvedValueOnce(
      page([], INDEX_PAGE_SIZE, 2 * INDEX_PAGE_SIZE),
    )
    searchMock.mockResolvedValue(page([folio()], INDEX_PAGE_SIZE))
    renderIndex('/index?finish=foil&page=3')

    expect(
      await screen.findByRole('link', { name: 'Lightning Bolt' }),
    ).toBeInTheDocument()
    expect(where()).toHaveTextContent(/^\?finish=foil$/)
    await waitFor(() =>
      expect(searchMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ finish: ['foil'], offset: 0 }),
        expect.any(AbortSignal),
      ),
    )
  })
})
