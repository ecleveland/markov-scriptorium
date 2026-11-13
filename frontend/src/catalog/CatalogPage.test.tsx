import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { lot } from '../test/fixtures'
import { renderWithQuery } from '../test/queryWrapper'
import { CatalogPage } from './CatalogPage'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return { ...actual, listInventory: vi.fn(), updateLot: vi.fn() }
})

import { ApiError, CATALOG_PAGE_SIZE, listInventory } from '../api'

const listMock = vi.mocked(listInventory)

function page(
  results: ReturnType<typeof lot>[],
  total = results.length,
  offset = 0,
) {
  return { results, total, limit: CATALOG_PAGE_SIZE, offset }
}

/** `count` distinct lots, ids counting down from `count` as newest first. */
function lots(count: number) {
  return Array.from({ length: count }, (_, i) => lot({ id: count - i }))
}

function renderCatalog(entry = '/catalog') {
  return renderWithQuery(
    <MemoryRouter initialEntries={[entry]}>
      <CatalogPage />
    </MemoryRouter>,
  )
}

/** The rubric numbers down the ledger, as shown. */
function entryNumbers(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll('.ledger__number'),
    (number) => number.textContent ?? '',
  )
}

function expectOneTitle() {
  const headings = screen.getAllByRole('heading', { level: 1 })
  expect(headings).toHaveLength(1)
  expect(headings[0]).toHaveTextContent('The Catalog')
}

afterEach(() => vi.clearAllMocks())

describe('CatalogPage', () => {
  it('titles the page once while the catalog is consulted', () => {
    listMock.mockReturnValue(new Promise(() => {}))
    renderCatalog()
    expectOneTitle()
  })

  it('titles the page once over a read failure', async () => {
    listMock.mockRejectedValue(new ApiError('database is locked', 500))
    renderCatalog()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('database is locked')
    expectOneTitle()
  })

  it('titles the page once over an empty collection, pointing at the three ways to fill it', async () => {
    listMock.mockResolvedValue(page([], 0))
    renderCatalog()

    expect(
      await screen.findByRole('heading', { name: 'Nothing inscribed yet' }),
    ).toBeInTheDocument()
    expectOneTitle()
    expect(screen.getByRole('link', { name: 'Inscribe' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'decklist' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'CSV export' })).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Lots' })).not.toBeInTheDocument()
  })

  it('titles the page once over the ledger', async () => {
    listMock.mockResolvedValue(page([lot()]))
    renderCatalog()
    await screen.findByRole('list', { name: 'Lots' })
    expectOneTitle()
  })

  it('opens with a sentence counting the entries in words', async () => {
    listMock.mockResolvedValue(page(lots(3)))
    renderCatalog()

    expect(
      await screen.findByText(
        'Three entries in the Catalog, the newest inscribed first.',
      ),
    ).toHaveClass('catalog__opening')
  })

  it('counts a single entry in the singular', async () => {
    listMock.mockResolvedValue(page([lot()]))
    renderCatalog()

    expect(
      await screen.findByText(
        'One entry in the Catalog, the newest inscribed first.',
      ),
    ).toBeInTheDocument()
  })

  it('counts the whole collection, not just the page on screen', async () => {
    listMock.mockResolvedValue(page(lots(25), 130))
    renderCatalog()

    expect(
      await screen.findByText(
        '130 entries in the Catalog, the newest inscribed first.',
      ),
    ).toBeInTheDocument()
  })

  it('lists an entry per owned lot in a ledger', async () => {
    listMock.mockResolvedValue(
      page([
        lot({ id: 2, location: 'Red binder' }),
        lot({
          id: 1,
          finish: 'foil',
          card: {
            name: 'Sol Ring',
            set_code: 'cmd',
            set_name: 'Commander 2011',
            collector_number: '222',
            rarity: 'uncommon',
            image_uris: null,
          },
        }),
      ]),
    )
    renderCatalog()

    const ledger = await screen.findByRole('list', { name: 'Lots' })
    const entries = within(ledger).getAllByRole('listitem')
    expect(entries).toHaveLength(2)
    expect(
      within(entries[0]).getByRole('link', { name: 'Lightning Bolt' }),
    ).toBeInTheDocument()
    expect(entries[0]).toHaveTextContent(
      'Limited Edition Alpha, no. 161. Red binder.',
    )
    expect(
      within(entries[1]).getByRole('link', { name: 'Sol Ring' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('numbers the entries from one on the first page', async () => {
    listMock.mockResolvedValue(page(lots(3)))
    const { container } = renderCatalog()

    await screen.findByRole('list', { name: 'Lots' })
    expect(entryNumbers(container)).toEqual(['1', '2', '3'])
  })

  it('numbers the second page on from 26', async () => {
    listMock.mockResolvedValue(page(lots(5), 30, CATALOG_PAGE_SIZE))
    const { container } = renderCatalog('/catalog?page=2')

    await screen.findByRole('list', { name: 'Lots' })
    expect(entryNumbers(container)).toEqual(['26', '27', '28', '29', '30'])
  })

  it('keeps the numbers tied to the entries on screen, not the pending page', async () => {
    const user = userEvent.setup()
    listMock.mockResolvedValueOnce(page([lot({ id: 1 })], 30))
    // The next page never resolves, so keepPreviousData holds page one on screen.
    listMock.mockReturnValueOnce(new Promise(() => {}))
    const { container } = renderCatalog()

    await screen.findByRole('list', { name: 'Lots' })
    await user.click(screen.getByRole('button', { name: 'Older entries' }))

    expect(entryNumbers(container)).toEqual(['1'])
  })

  it('pages forward by the page size and back again', async () => {
    const user = userEvent.setup()
    listMock.mockResolvedValue(page([lot()], 60))
    renderCatalog()

    const pager = await screen.findByRole('navigation', {
      name: 'Catalog pages',
    })
    expect(pager).toHaveClass('pager')
    expect(
      within(pager).getByRole('button', { name: 'Newer entries' }),
    ).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Older entries' }))
    await waitFor(() =>
      expect(listMock).toHaveBeenCalledWith(CATALOG_PAGE_SIZE),
    )

    await user.click(
      await screen.findByRole('button', { name: 'Newer entries' }),
    )
    await waitFor(() => expect(listMock).toHaveBeenLastCalledWith(0))
  })

  it('disables Older entries on the last page', async () => {
    listMock.mockResolvedValue(page([lot()], 30, CATALOG_PAGE_SIZE))
    renderCatalog('/catalog?page=2')
    expect(
      await screen.findByRole('button', { name: 'Older entries' }),
    ).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Newer entries' })).toBeEnabled()
  })

  it('shows no pager when the collection fits on one page', async () => {
    listMock.mockResolvedValue(page(lots(3), CATALOG_PAGE_SIZE))
    renderCatalog()

    await screen.findByRole('list', { name: 'Lots' })
    expect(
      screen.queryByRole('navigation', { name: 'Catalog pages' }),
    ).not.toBeInTheDocument()
  })

  it('reads the page out of the URL, so a folio round trip keeps your place', async () => {
    listMock.mockResolvedValue(page([lot()], 60, CATALOG_PAGE_SIZE))
    renderCatalog('/catalog?page=2')

    await waitFor(() =>
      expect(listMock).toHaveBeenCalledWith(CATALOG_PAGE_SIZE),
    )
    expect(
      await screen.findByRole('button', { name: 'Newer entries' }),
    ).toBeEnabled()
  })

  it('falls back to the first page on a nonsense ?page=', async () => {
    listMock.mockResolvedValue(page([lot()], 1))
    renderCatalog('/catalog?page=-3')
    await waitFor(() => expect(listMock).toHaveBeenCalledWith(0))
  })

  it('lands on the last real page when the collection shrank underneath it', async () => {
    // Page 2 held the only folio past 25; removing it leaves ?page=2 pointing
    // past the end, which used to render an empty list.
    listMock.mockResolvedValueOnce(
      page([], CATALOG_PAGE_SIZE, CATALOG_PAGE_SIZE),
    )
    listMock.mockResolvedValue(page([lot()], CATALOG_PAGE_SIZE))
    renderCatalog('/catalog?page=2')

    expect(
      await screen.findByRole('link', { name: 'Lightning Bolt' }),
    ).toBeInTheDocument()
    await waitFor(() => expect(listMock).toHaveBeenLastCalledWith(0))
  })
})
