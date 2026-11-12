import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deck, facets, folio, lot } from '../test/fixtures'
import { renderWithQuery } from '../test/queryWrapper'
import { IndexPage } from './IndexPage'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return {
    ...actual,
    searchFolios: vi.fn(),
    listFacets: vi.fn(),
    listDecks: vi.fn(),
    listInventory: vi.fn(),
  }
})

import {
  ApiError,
  INDEX_PAGE_SIZE,
  listDecks,
  listFacets,
  listInventory,
  searchFolios,
  type InventoryLot,
  type SearchFolio,
} from '../api'

const searchMock = vi.mocked(searchFolios)
const newestMock = vi.mocked(listInventory)

/** GET /inventory as the plate asks for it: the one newest lot, if any. */
function newest(...results: InventoryLot[]) {
  return { results, total: results.length, limit: 1, offset: 0 }
}

/** The newest lot, named apart from the search fixtures so nothing collides. */
const CROWN = lot({
  id: 7,
  scryfall_id: 'edgar-vow',
  quantity: 2,
  finish: 'foil',
  condition: 'LP',
  location: null,
  card: {
    name: 'Edgar, Charmed Groom',
    set_code: 'vow',
    set_name: 'Innistrad: Crimson Vow',
    collector_number: '320',
    rarity: 'mythic',
    image_uris: null,
  },
  folio: { owned: 2, reserved: 0, available: 2 },
})

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

/** The browser's Back button, for stepping to an earlier Index URL. */
function Back() {
  const navigate = useNavigate()
  return (
    <button type="button" onClick={() => navigate(-1)}>
      Browser back
    </button>
  )
}

/** Renders the Index at the last entry, with the earlier ones behind it. */
function renderIndex(...entries: string[]) {
  const history = entries.length === 0 ? ['/index'] : entries
  return renderWithQuery(
    <MemoryRouter initialEntries={history} initialIndex={history.length - 1}>
      <Routes>
        <Route
          path="/index"
          element={
            <>
              <IndexPage />
              <Where />
              <Back />
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

/** The sentence under the heading; empty while it has nothing settled to say. */
function opening() {
  const paragraph = document.querySelector('.index__opening')
  if (paragraph === null) throw new Error('no opening paragraph')
  return paragraph
}

/** The rubric numbers down a ledger, as printed. */
function entryNumbers() {
  return Array.from(document.querySelectorAll('.ledger__number')).map(
    (number) => number.textContent,
  )
}

beforeEach(() => {
  vi.mocked(listFacets).mockResolvedValue(facets())
  vi.mocked(listDecks).mockResolvedValue([])
  // No newest lot unless a test asks for one, so the plate stays out of the
  // way of every query by name.
  newestMock.mockResolvedValue(newest())
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
      bolt.getByText('Limited Edition Alpha, no. 161. Unshelved.'),
    ).toHaveClass('folio-tile__printing')
    // Nonfoil is the plain case and says nothing.
    expect(bolt.queryByText('nonfoil')).not.toBeInTheDocument()
    expect(tiles[0].querySelector('.finish-word')).toBeNull()
    expect(bolt.getByText('×1')).toBeInTheDocument()
    expect(bolt.queryByText(/in Tomes/)).not.toBeInTheDocument()

    const ring = within(tiles[1])
    expect(ring.getByRole('link', { name: 'Sol Ring' })).toBeInTheDocument()
    expect(ring.getByText('foil')).toHaveClass('finish-word')
    expect(ring.getByText('×4')).toBeInTheDocument()
    expect(ring.getByText('4 copies')).toBeInTheDocument()
    expect(ring.getByText('2 of 4 in Tomes · 2 free')).toBeInTheDocument()
    expect(
      ring.getByText('Commander 2021, no. 263. Red binder and Trade box.'),
    ).toBeInTheDocument()
    expect(
      ring.getByRole('img', { name: 'Sol Ring (no image in the catalog)' }),
    ).toBeInTheDocument()
    expect(document.querySelector('.tag')).toBeNull()
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

  it('hands the open folio the Index URL from the ledger too', async () => {
    const user = userEvent.setup()
    searchMock.mockResolvedValue(page([folio()]))
    renderIndex('/index?finish=nonfoil&view=list')

    const ledger = await screen.findByRole('list', { name: 'Folios' })
    expect(ledger).toHaveClass('ledger')
    await user.click(
      within(ledger).getByRole('link', { name: 'Lightning Bolt' }),
    )
    expect(
      screen.getByText('Opened /index/bolt-lea from ?finish=nonfoil&view=list'),
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

  it('sorts by the pressed key and flips the order with the button', async () => {
    const user = userEvent.setup()
    searchMock.mockResolvedValue(page([folio()], 60, INDEX_PAGE_SIZE))
    renderIndex('/index?page=2')

    const sortBy = await screen.findByRole('group', { name: 'Sort by' })
    const keys = within(sortBy).getAllByRole('button')
    // No price sort until the search has a price key (ADR 0021).
    expect(keys.map((key) => key.textContent)).toEqual([
      'Date added',
      'Name',
      'Set',
      'Copies',
    ])
    expect(keys.map((key) => key.getAttribute('aria-pressed'))).toEqual([
      'true',
      'false',
      'false',
      'false',
    ])
    for (const key of keys) expect(key).toHaveClass('index__toggle')

    const order = screen.getByRole('button', { name: 'Newest first' })
    expect(order).toHaveClass('index__toggle')
    expect(order).not.toHaveAttribute('aria-pressed')
    await user.click(order)
    expect(where()).toHaveTextContent('?order=asc')
    expect(
      screen.getByRole('button', { name: 'Oldest first' }),
    ).toBeInTheDocument()

    await user.click(within(sortBy).getByRole('button', { name: 'Name' }))
    expect(where()).toHaveTextContent('?sort=name')
    expect(
      within(sortBy).getByRole('button', { name: 'Name' }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(
      within(sortBy).getByRole('button', { name: 'Date added' }),
    ).toHaveAttribute('aria-pressed', 'false')
    await user.click(screen.getByRole('button', { name: 'A to Z' }))
    expect(where()).toHaveTextContent('?sort=name&order=desc')
    expect(screen.getByRole('button', { name: 'Z to A' })).toBeInTheDocument()

    await user.click(within(sortBy).getByRole('button', { name: 'Copies' }))
    expect(
      screen.getByRole('button', { name: 'Most copies' }),
    ).toBeInTheDocument()
    await user.click(within(sortBy).getByRole('button', { name: 'Set' }))
    expect(screen.getByRole('button', { name: 'A to Z' })).toBeInTheDocument()

    await waitFor(() =>
      expect(searchMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ sort: 'set', order: 'asc', offset: 0 }),
        expect.any(AbortSignal),
      ),
    )
  })

  it('swaps the grid for a ledger and keeps the page', async () => {
    const user = userEvent.setup()
    searchMock.mockResolvedValue(page([SOL_RING], 60, INDEX_PAGE_SIZE))
    renderIndex('/index?finish=foil&page=2')

    expect((await screen.findByRole('list', { name: 'Folios' })).tagName).toBe(
      'UL',
    )
    const views = screen.getByRole('group', { name: 'View' })
    const grid = within(views).getByRole('button', { name: 'Grid' })
    expect(grid).toHaveAttribute('aria-pressed', 'true')
    expect(grid).toHaveClass('index__toggle')
    await user.click(within(views).getByRole('button', { name: 'List' }))

    expect(where()).toHaveTextContent('?finish=foil&view=list&page=2')
    expect(within(views).getByRole('button', { name: 'List' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(grid).toHaveAttribute('aria-pressed', 'false')

    // The same name finds the results in either view.
    const ledger = screen.getByRole('list', { name: 'Folios' })
    expect(ledger.tagName).toBe('OL')
    expect(ledger).toHaveClass('ledger')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    const entries = within(ledger).getAllByRole('listitem')
    expect(entries).toHaveLength(1)
    const ring = within(entries[0])
    expect(ring.getByRole('link', { name: 'Sol Ring' })).toHaveAttribute(
      'href',
      '/index/sol-ring-c21',
    )
    expect(ring.getByText('foil')).toHaveClass('finish-word')
    expect(
      ring.getByText('Commander 2021, no. 263. Red binder and Trade box.'),
    ).toHaveClass('ledger__where')
    expect(entries[0].querySelector('.ledger__figure')).toHaveTextContent(/^4$/)
    expect(ring.getByText('copies', { exact: false })).toHaveClass(
      'visually-hidden',
    )
    expect(
      ring.getByText('near mint, lightly played, 2 in Tomes, 2 free'),
    ).toHaveClass('ledger__note')
    // Page two's first entry carries on from page one's last.
    expect(entryNumbers()).toEqual(['25'])

    await user.click(within(views).getByRole('button', { name: 'Grid' }))
    expect(where()).toHaveTextContent('?finish=foil&page=2')
  })

  it('numbers the ledger from one on the first page, with no finish word for nonfoil', async () => {
    searchMock.mockResolvedValue(page([folio(), SOL_RING]))
    renderIndex('/index?view=list')

    const ledger = await screen.findByRole('list', { name: 'Folios' })
    expect(entryNumbers()).toEqual(['1', '2'])
    const [bolt, ring] = within(ledger).getAllByRole('listitem')
    expect(
      within(bolt).getByText('Limited Edition Alpha, no. 161. Unshelved.'),
    ).toBeInTheDocument()
    expect(bolt.querySelector('.finish-word')).toBeNull()
    expect(within(bolt).getByText('near mint')).toHaveClass('ledger__note')
    expect(within(bolt).getByText('copy', { exact: false })).toHaveClass(
      'visually-hidden',
    )
    expect(ring.querySelector('.finish-word')).toHaveTextContent('foil')
  })

  it('numbers from the offset the shown rows came from', async () => {
    const user = userEvent.setup()
    searchMock.mockResolvedValueOnce(page([folio()], 30))
    searchMock.mockReturnValueOnce(new Promise(() => {}))
    renderIndex('/index?view=list')

    await screen.findByRole('list', { name: 'Folios' })
    await user.click(screen.getByRole('button', { name: 'Later folios' }))
    // Page two is still loading, so the rows on screen are page one's.
    expect(where()).toHaveTextContent('?view=list&page=2')
    expect(entryNumbers()).toEqual(['1'])
  })

  it('pages forward and back by the Index page size', async () => {
    const user = userEvent.setup()
    searchMock.mockResolvedValue(page([folio()], 60))
    renderIndex('/index?finish=foil')

    const pager = await screen.findByRole('navigation', { name: 'Index pages' })
    expect(pager).toHaveClass('pager')
    expect(
      within(pager)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Earlier folios', 'Later folios'])
    expect(
      screen.getByRole('button', { name: 'Earlier folios' }),
    ).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Later folios' }))
    expect(where()).toHaveTextContent('?finish=foil&page=2')
    await waitFor(() =>
      expect(searchMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ offset: INDEX_PAGE_SIZE }),
        expect.any(AbortSignal),
      ),
    )

    await user.click(screen.getByRole('button', { name: 'Earlier folios' }))
    expect(where()).toHaveTextContent(/^\?finish=foil$/)
  })

  it('has no pager when every folio fits on one page', async () => {
    searchMock.mockResolvedValue(page([folio()], 1))
    renderIndex()
    await screen.findByRole('list', { name: 'Folios' })
    expect(
      screen.queryByRole('navigation', { name: 'Index pages' }),
    ).not.toBeInTheDocument()
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

  it('shows the empty state in place of the plate when nothing is inscribed', async () => {
    searchMock.mockResolvedValue(page([], 0))
    newestMock.mockResolvedValue(newest(CROWN))
    renderIndex()

    expect(
      await screen.findByRole('heading', { name: 'Nothing inscribed yet' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('region', { name: 'Newest inscription' }),
    ).not.toBeInTheDocument()
    expect(document.querySelector('.index__opening')).toBeNull()
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
    expect(where()).toHaveTextContent(/^\?view=list$/)
    expect(
      await screen.findByRole('link', { name: 'Lightning Bolt' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'etched' })).not.toBeChecked()
  })

  it('keeps the view, sort and order when the filters are cleared', async () => {
    const user = userEvent.setup()
    searchMock.mockResolvedValueOnce(page([], 0))
    searchMock.mockResolvedValue(page([SOL_RING]))
    renderIndex('/index?finish=etched&sort=name&order=desc&view=list')

    await user.click(
      await screen.findByRole('button', { name: 'Clear filters' }),
    )
    expect(where()).toHaveTextContent(/^\?sort=name&order=desc&view=list$/)
    await waitFor(() =>
      expect(searchMock).toHaveBeenLastCalledWith(
        {
          sort: 'name',
          order: 'desc',
          limit: INDEX_PAGE_SIZE,
          offset: 0,
        },
        expect.any(AbortSignal),
      ),
    )
    const ledger = await screen.findByRole('list', { name: 'Folios' })
    expect(ledger).toHaveClass('ledger')
    expect(
      within(ledger).getByRole('link', { name: 'Sol Ring' }),
    ).toBeInTheDocument()
  })

  it('consults the catalog instead of repeating "nothing matches" while a looser filter loads', async () => {
    const user = userEvent.setup()
    searchMock.mockResolvedValueOnce(page([], 0))
    searchMock.mockReturnValueOnce(new Promise(() => {}))
    renderIndex('/index?finish=etched')

    await screen.findByText('Nothing in the Index matches these filters.')
    await user.click(screen.getByRole('checkbox', { name: 'etched' }))

    expect(
      screen.queryByText('Nothing in the Index matches these filters.'),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Clear filters' }),
    ).not.toBeInTheDocument()
    expect(screen.getByText('Consulting the catalog…')).toBeInTheDocument()
  })

  it('holds the pager still while the next page loads', async () => {
    const user = userEvent.setup()
    searchMock.mockResolvedValueOnce(page([folio()], 60))
    searchMock.mockReturnValueOnce(new Promise(() => {}))
    renderIndex()

    await user.click(
      await screen.findByRole('button', { name: 'Later folios' }),
    )
    expect(where()).toHaveTextContent(/^\?page=2$/)
    // Page two of sixty has a page after it, but the total on hand is the
    // previous request's, so neither button may act on it yet.
    expect(screen.getByRole('button', { name: 'Later folios' })).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Earlier folios' }),
    ).toBeDisabled()
  })

  it('surfaces a read failure as an alert', async () => {
    searchMock.mockRejectedValue(new ApiError('database is locked', 500))
    renderIndex()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'database is locked',
    )
  })

  it('prints no sentence from the previous request while the next one loads', async () => {
    const user = userEvent.setup()
    searchMock.mockResolvedValueOnce(page([folio()], 30))
    searchMock.mockReturnValueOnce(new Promise(() => {}))
    renderIndex()

    await waitFor(() =>
      expect(opening()).toHaveTextContent('Thirty folios. No Volumes'),
    )
    await user.click(screen.getByRole('checkbox', { name: 'foil' }))
    // Thirty is the whole Catalog's count, not the foils'.
    expect(where()).toHaveTextContent('?finish=foil')
    expect(screen.getByRole('link', { name: 'Lightning Bolt' })).toBeVisible()
    expect(opening()).toBeEmptyDOMElement()
    expect(screen.queryByText(/match/)).not.toBeInTheDocument()
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

  it('lands on page one when the offset sits exactly at the total', async () => {
    searchMock.mockResolvedValueOnce(page([], INDEX_PAGE_SIZE, INDEX_PAGE_SIZE))
    searchMock.mockResolvedValue(page([folio()], INDEX_PAGE_SIZE))
    renderIndex('/index?page=2')

    await waitFor(() =>
      expect(searchMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ offset: 0 }),
        expect.any(AbortSignal),
      ),
    )
    expect(where()).toBeEmptyDOMElement()
  })

  it('counts a part-full last page when it lands there', async () => {
    searchMock.mockResolvedValueOnce(page([], 30, 2 * INDEX_PAGE_SIZE))
    searchMock.mockResolvedValue(page([folio()], 30, INDEX_PAGE_SIZE))
    renderIndex('/index?page=3')

    await waitFor(() =>
      expect(searchMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ offset: INDEX_PAGE_SIZE }),
        expect.any(AbortSignal),
      ),
    )
    expect(where()).toHaveTextContent(/^\?page=2$/)
  })

  it('has no pager when the one page is exactly full', async () => {
    const full = Array.from({ length: INDEX_PAGE_SIZE }, (_, i) =>
      folio({ scryfall_id: `bolt-${i}` }),
    )
    searchMock.mockResolvedValue(page(full, INDEX_PAGE_SIZE))
    renderIndex()
    await screen.findByRole('list', { name: 'Folios' })
    expect(
      screen.queryByRole('navigation', { name: 'Index pages' }),
    ).not.toBeInTheDocument()
  })

  it('disables Later folios when the last page is exactly full', async () => {
    const full = Array.from({ length: INDEX_PAGE_SIZE }, (_, i) =>
      folio({ scryfall_id: `bolt-${i}` }),
    )
    searchMock.mockResolvedValue(
      page(full, 2 * INDEX_PAGE_SIZE, INDEX_PAGE_SIZE),
    )
    renderIndex('/index?page=2')
    expect(
      await screen.findByRole('button', { name: 'Later folios' }),
    ).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Earlier folios' })).toBeEnabled()
  })

  it('keeps the search and facets up while cleared filters load', async () => {
    const user = userEvent.setup()
    searchMock.mockResolvedValueOnce(page([], 0))
    searchMock.mockReturnValueOnce(new Promise(() => {}))
    renderIndex('/index?finish=foil')

    await user.click(
      await screen.findByRole('button', { name: 'Clear filters' }),
    )
    expect(where()).toBeEmptyDOMElement()
    // The empty filtered result is still the placeholder here. It says nothing
    // about whether the whole collection is empty.
    expect(
      screen.queryByRole('heading', { name: 'Nothing inscribed yet' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByLabelText('Seek a card by name, or part of one'),
    ).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'foil' })).toBeInTheDocument()
  })

  it('does not redirect on the previous result while a later page loads', async () => {
    const user = userEvent.setup()
    searchMock.mockResolvedValueOnce(page([folio(), SOL_RING], 2))
    searchMock.mockReturnValueOnce(new Promise(() => {}))
    renderIndex('/index?page=3', '/index?finish=foil')

    await screen.findByText('Two folios match these filters.')
    await user.click(screen.getByRole('button', { name: 'Browser back' }))

    // Two folios cannot fill page 3, but they are the old filter's count.
    expect(where()).toHaveTextContent(/^\?page=3$/)
    expect(searchMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ offset: 2 * INDEX_PAGE_SIZE }),
      expect.any(AbortSignal),
    )
  })
})

describe('IndexPage opening sentence', () => {
  it('counts the folios, the Volumes they sit in and the Tomes bound', async () => {
    searchMock.mockResolvedValue(page([folio(), SOL_RING]))
    vi.mocked(listFacets).mockResolvedValue(
      facets({
        locations: [
          { location: 'Red binder', folios: 1 },
          { location: 'Trade box', folios: 1 },
        ],
      }),
    )
    vi.mocked(listDecks).mockResolvedValue([deck()])
    renderIndex()

    await waitFor(() =>
      expect(opening()).toHaveTextContent(
        'Two folios. Two Volumes on the shelf. One Tome bound.',
      ),
    )
    // It sits between the heading and the search.
    const heading = screen.getByRole('heading', { level: 1 })
    const search = screen.getByRole('search')
    expect(
      heading.compareDocumentPosition(opening()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(
      opening().compareDocumentPosition(search) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(opening().tagName).toBe('P')
  })

  it('says no Volumes are on the shelf when the facets list none', async () => {
    searchMock.mockResolvedValue(page([folio()]))
    renderIndex()
    await waitFor(() =>
      expect(opening()).toHaveTextContent(
        /^One folio\. No Volumes on the shelf\. No Tomes bound\.$/,
      ),
    )
  })

  it('leaves out the Volumes and the Tomes when they cannot be read', async () => {
    searchMock.mockResolvedValue(page([folio(), SOL_RING]))
    vi.mocked(listFacets).mockRejectedValue(new ApiError('locked', 500))
    vi.mocked(listDecks).mockRejectedValue(new ApiError('locked', 500))
    renderIndex()

    await screen.findByText('Facet values could not be read.')
    await waitFor(() => expect(listDecks).toHaveBeenCalled())
    await waitFor(() => expect(opening()).toHaveTextContent(/^Two folios\.$/))
  })

  it('leaves out the Volumes while the facets load', async () => {
    searchMock.mockResolvedValue(page([folio(), SOL_RING]))
    vi.mocked(listFacets).mockReturnValue(new Promise(() => {}))
    vi.mocked(listDecks).mockResolvedValue([deck(), deck({ id: 2 })])
    renderIndex()

    await waitFor(() =>
      expect(opening()).toHaveTextContent(/^Two folios\. Two Tomes bound\.$/),
    )
  })

  it('quotes the name when only a name narrows the Index', async () => {
    searchMock.mockResolvedValue(page([folio()]))
    renderIndex('/index?name=bolt')
    await waitFor(() =>
      expect(opening()).toHaveTextContent(/^One folio matches 'bolt'\.$/),
    )
  })

  it('names the filters when no name narrows the Index', async () => {
    searchMock.mockResolvedValue(page([folio(), SOL_RING], 40))
    renderIndex('/index?finish=foil')
    await waitFor(() =>
      expect(opening()).toHaveTextContent(
        /^Forty folios match these filters\.$/,
      ),
    )
  })

  it('quotes the name within the filters when both narrow', async () => {
    searchMock.mockResolvedValue(page([folio(), SOL_RING]))
    renderIndex('/index?name=%20bolt%20&set=lea')
    await waitFor(() =>
      expect(opening()).toHaveTextContent(
        /^Two folios match 'bolt' within these filters\.$/,
      ),
    )
  })

  it('keeps a filtered sentence while the next page loads', async () => {
    const user = userEvent.setup()
    searchMock.mockResolvedValueOnce(page([folio()], 60))
    searchMock.mockReturnValueOnce(new Promise(() => {}))
    renderIndex('/index?finish=foil')

    await waitFor(() =>
      expect(opening()).toHaveTextContent(
        /^Sixty folios match these filters\.$/,
      ),
    )
    await user.click(screen.getByRole('button', { name: 'Later folios' }))
    expect(where()).toHaveTextContent(/^\?finish=foil&page=2$/)
    // Page two of the same filters has the same count.
    expect(opening()).toHaveTextContent(/^Sixty folios match these filters\.$/)
  })

  it('drops the remembered sentence when the filters change while loading', async () => {
    const user = userEvent.setup()
    searchMock.mockResolvedValueOnce(page([], 0))
    searchMock.mockResolvedValueOnce(page([folio()], 40))
    searchMock.mockReturnValue(new Promise(() => {}))
    renderIndex('/index?finish=etched')

    await user.click(
      await screen.findByRole('button', { name: 'Clear filters' }),
    )
    await waitFor(() => expect(opening()).toHaveTextContent(/^Forty folios\./))
    await user.click(screen.getByRole('checkbox', { name: 'foil' }))
    expect(where()).toHaveTextContent(/^\?finish=foil$/)
    // Forty is the whole Catalog's count, not the foils'.
    expect(screen.getByRole('link', { name: 'Lightning Bolt' })).toBeVisible()
    expect(opening()).toBeEmptyDOMElement()
  })

  it('keeps the paragraph empty while the first answer loads', () => {
    searchMock.mockReturnValue(new Promise(() => {}))
    renderIndex()
    expect(opening()).toBeEmptyDOMElement()
  })

  it('says nothing matches instead of a sentence', async () => {
    searchMock.mockResolvedValue(page([], 0))
    renderIndex('/index?finish=etched')
    await screen.findByText('Nothing in the Index matches these filters.')
    expect(opening()).toBeEmptyDOMElement()
  })
})

describe('IndexPage plate', () => {
  it('opens the unfiltered Index with the newest inscription', async () => {
    searchMock.mockResolvedValue(page([folio(), SOL_RING]))
    newestMock.mockResolvedValue(newest(CROWN))
    renderIndex()

    const plate = within(
      await screen.findByRole('region', { name: 'Newest inscription' }),
    )
    expect(newestMock).toHaveBeenCalledWith(0, 1)
    expect(plate.getByRole('heading', { level: 2 })).toHaveTextContent(
      'Edgar, Charmed Groom foil',
    )
    expect(
      plate.getByText('Innistrad: Crimson Vow, no. 320, mythic.'),
    ).toBeInTheDocument()
    expect(
      plate.getByText(
        'Two copies, lightly played, unshelved. Not yet claimed by any Tome.',
      ),
    ).toBeInTheDocument()
    expect(
      plate.getByRole('link', { name: 'Shelve it in a Volume' }),
    ).toHaveAttribute('href', '/catalog/7')
    expect(plate.getByRole('link', { name: 'Open the folio' })).toHaveAttribute(
      'href',
      '/index/edgar-vow',
    )

    // The plate sits between the opening sentence and the search.
    const region = screen.getByRole('region', { name: 'Newest inscription' })
    expect(
      opening().compareDocumentPosition(region) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(
      region.compareDocumentPosition(screen.getByRole('search')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('shows the newest lot under any sort', async () => {
    searchMock.mockResolvedValue(page([folio(), SOL_RING]))
    newestMock.mockResolvedValue(newest(CROWN))
    renderIndex('/index?sort=name&view=list')
    expect(
      await screen.findByRole('region', { name: 'Newest inscription' }),
    ).toHaveTextContent('Edgar, Charmed Groom')
  })

  it('stays, with the sentence, while a new sort loads', async () => {
    const user = userEvent.setup()
    searchMock.mockResolvedValueOnce(page([folio()], 30))
    searchMock.mockReturnValueOnce(new Promise(() => {}))
    newestMock.mockResolvedValue(newest(CROWN))
    renderIndex()

    await screen.findByRole('region', { name: 'Newest inscription' })
    const sentence =
      /^Thirty folios\. No Volumes on the shelf\. No Tomes bound\.$/
    await waitFor(() => expect(opening()).toHaveTextContent(sentence))

    const sortBy = screen.getByRole('group', { name: 'Sort by' })
    await user.click(within(sortBy).getByRole('button', { name: 'Name' }))
    expect(where()).toHaveTextContent(/^\?sort=name$/)
    // Sorting changes neither the count nor the newest lot.
    expect(
      screen.getByRole('region', { name: 'Newest inscription' }),
    ).toBeInTheDocument()
    expect(opening()).toHaveTextContent(sentence)
  })

  it('is left out when a filter narrows the Index', async () => {
    searchMock.mockResolvedValue(page([folio()]))
    newestMock.mockResolvedValue(newest(CROWN))
    renderIndex('/index?finish=nonfoil')

    await screen.findByText('One folio matches these filters.')
    expect(
      screen.queryByRole('region', { name: 'Newest inscription' }),
    ).not.toBeInTheDocument()
  })

  it('is left out on a later page', async () => {
    searchMock.mockResolvedValue(page([folio()], 30, INDEX_PAGE_SIZE))
    newestMock.mockResolvedValue(newest(CROWN))
    renderIndex('/index?page=2')

    await screen.findByRole('link', { name: 'Lightning Bolt' })
    // A later page of the whole Catalog still opens on the whole count.
    await waitFor(() =>
      expect(opening()).toHaveTextContent(
        /^Thirty folios\. No Volumes on the shelf\. No Tomes bound\.$/,
      ),
    )
    expect(
      screen.queryByRole('region', { name: 'Newest inscription' }),
    ).not.toBeInTheDocument()
  })
})
