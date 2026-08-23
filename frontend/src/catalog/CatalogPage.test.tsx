import { screen, waitFor } from '@testing-library/react'
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

function page(results: ReturnType<typeof lot>[], total = results.length) {
  return { results, total, limit: CATALOG_PAGE_SIZE, offset: 0 }
}

function renderCatalog(entry = '/catalog') {
  return renderWithQuery(
    <MemoryRouter initialEntries={[entry]}>
      <CatalogPage />
    </MemoryRouter>,
  )
}

afterEach(() => vi.clearAllMocks())

describe('CatalogPage', () => {
  it('lists a row per owned lot with its folio, condition and volume', async () => {
    listMock.mockResolvedValue(
      page([
        lot({ id: 1, condition: 'LP', location: 'Red binder' }),
        lot({
          id: 2,
          quantity: 3,
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

    expect(
      await screen.findByRole('link', { name: 'Lightning Bolt' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sol Ring' })).toBeInTheDocument()
    expect(screen.getByText(/LEA #161/)).toBeInTheDocument()
    expect(screen.getByText('LP')).toBeInTheDocument()
    expect(screen.getByText('Red binder')).toBeInTheDocument()
    expect(screen.getByText('Showing 1 to 2 of 2 folios')).toBeInTheDocument()
  })

  it('marks a lot with no location as unshelved rather than blank', async () => {
    listMock.mockResolvedValue(page([lot({ location: null })]))
    renderCatalog()
    expect(await screen.findByText('unshelved')).toBeInTheDocument()
  })

  it('points an empty collection at the three ways to fill it', async () => {
    listMock.mockResolvedValue(page([], 0))
    renderCatalog()

    expect(
      await screen.findByRole('link', { name: 'Inscribe' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'decklist' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'CSV export' })).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('surfaces a read failure instead of showing an empty catalog', async () => {
    listMock.mockRejectedValue(new ApiError('database is locked', 500))
    renderCatalog()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('database is locked')
  })

  it('pages forward by the page size and back again', async () => {
    const user = userEvent.setup()
    listMock.mockResolvedValue(page([lot()], 60))
    renderCatalog()

    const previous = await screen.findByRole('button', { name: 'Previous' })
    expect(previous).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() =>
      expect(listMock).toHaveBeenCalledWith(CATALOG_PAGE_SIZE),
    )

    await user.click(await screen.findByRole('button', { name: 'Previous' }))
    await waitFor(() => expect(listMock).toHaveBeenLastCalledWith(0))
  })

  it('disables Next on the last page', async () => {
    listMock.mockResolvedValue(page([lot()], 1))
    renderCatalog()
    expect(await screen.findByRole('button', { name: 'Next' })).toBeDisabled()
  })

  it('keeps the shown range tied to the rows on screen, not the pending page', async () => {
    const user = userEvent.setup()
    listMock.mockResolvedValueOnce({
      results: [lot({ id: 1 })],
      total: 30,
      limit: CATALOG_PAGE_SIZE,
      offset: 0,
    })
    // The next page never resolves, so keepPreviousData holds page one on screen.
    listMock.mockReturnValueOnce(new Promise(() => {}))
    renderCatalog()

    await screen.findByText('Showing 1 to 1 of 30 folios')
    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(screen.getByText('Showing 1 to 1 of 30 folios')).toBeInTheDocument()
  })

  it('reads the page out of the URL, so a folio round trip keeps your place', async () => {
    listMock.mockResolvedValue({
      results: [lot()],
      total: 60,
      limit: CATALOG_PAGE_SIZE,
      offset: CATALOG_PAGE_SIZE,
    })
    renderCatalog('/catalog?page=2')

    await waitFor(() =>
      expect(listMock).toHaveBeenCalledWith(CATALOG_PAGE_SIZE),
    )
    expect(
      await screen.findByRole('button', { name: 'Previous' }),
    ).toBeEnabled()
  })

  it('falls back to the first page on a nonsense ?page=', async () => {
    listMock.mockResolvedValue(page([lot()], 1))
    renderCatalog('/catalog?page=-3')
    await waitFor(() => expect(listMock).toHaveBeenCalledWith(0))
  })
})
