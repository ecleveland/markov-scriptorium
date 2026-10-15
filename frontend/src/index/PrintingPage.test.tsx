import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { across, lot, owned } from '../test/fixtures'
import { renderWithQuery } from '../test/queryWrapper'
import { PrintingPage } from './PrintingPage'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return { ...actual, ownedForPrinting: vi.fn(), updateLot: vi.fn() }
})

import { ApiError, ownedForPrinting } from '../api'

const ownedMock = vi.mocked(ownedForPrinting)

function Landed() {
  const { pathname, search, state } = useLocation()
  // Loosely typed: a lot page reads `back`, the Index reads nothing.
  const back = (
    state as {
      back?: { to: string; label: string; state?: { indexSearch?: string } }
    } | null
  )?.back
  return (
    <>
      <p>
        Landed on {pathname}
        {search}
      </p>
      {back && (
        <p>
          Back to {back.to} as {back.label} with{' '}
          {back.state?.indexSearch ?? 'no search'}
        </p>
      )}
    </>
  )
}

function renderPrinting(
  entry: string | { pathname: string; state: unknown } = '/index/bolt-lea',
) {
  return renderWithQuery(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/index/:scryfallId" element={<PrintingPage />} />
        <Route path="/index" element={<Landed />} />
        <Route path="/catalog/:lotId" element={<Landed />} />
      </Routes>
    </MemoryRouter>,
  )
}

const TWO_LOTS = owned({
  lots: [
    lot({ id: 7, quantity: 2, location: 'Red binder' }),
    lot({ id: 9, finish: 'foil', condition: 'LP', quantity: 1 }),
  ],
  reservations: [
    { finish: 'nonfoil', owned: 2, reserved: 1, available: 1 },
    { finish: 'foil', owned: 1, reserved: 0, available: 1 },
  ],
  total_quantity: 3,
  across_printings: across({ total_quantity: 3 }),
})

afterEach(() => vi.clearAllMocks())

describe('PrintingPage', () => {
  it('heads the page with the card, its printing and rarity', async () => {
    ownedMock.mockResolvedValue(TWO_LOTS)
    renderPrinting()

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Lightning Bolt' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Limited Edition Alpha · LEA #161 · common'),
    ).toBeInTheDocument()
    // The plate comes first; each lot row below carries its own thumb.
    expect(
      screen.getAllByRole('img', {
        name: 'Lightning Bolt (no image in the catalog)',
      })[0],
    ).toHaveClass('card-thumb--full')
    expect(ownedMock).toHaveBeenCalledWith('bolt-lea')
  })

  it('states owned, held and free copies for each finish', async () => {
    ownedMock.mockResolvedValue(TWO_LOTS)
    renderPrinting()

    const nonfoil = await screen.findByText('nonfoil', { selector: 'dt' })
    expect(nonfoil.nextElementSibling).toHaveTextContent(
      '2 owned · 1 in Tomes · 1 free',
    )
    expect(
      screen.getByText('foil', { selector: 'dt' }).nextElementSibling,
    ).toHaveTextContent('1 owned · 0 in Tomes · 1 free')
  })

  it('lists every lot as a Catalog row that opens the lot', async () => {
    const user = userEvent.setup()
    ownedMock.mockResolvedValue(TWO_LOTS)
    renderPrinting()

    const table = await screen.findByRole('table')
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['Art', 'Card', 'Finish', 'Condition', 'Volume', 'Copies'])
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('Red binder')
    expect(rows[1]).toHaveTextContent('LP')
    expect(
      within(rows[0]).getByRole('button', {
        name: 'Increase quantity of Lightning Bolt',
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('region', { name: 'Lots of this printing' }),
    ).toHaveAttribute('tabindex', '0')

    await user.click(
      within(rows[1]).getByRole('link', { name: 'Lightning Bolt' }),
    )
    expect(screen.getByText('Landed on /catalog/9')).toBeInTheDocument()
  })

  it('closes with the ownership summary across printings', async () => {
    ownedMock.mockResolvedValue(TWO_LOTS)
    renderPrinting()
    expect(
      await screen.findByRole('complementary', {
        name: 'Ownership across printings',
      }),
    ).toHaveTextContent(
      'You own 3 copies of Lightning Bolt, all in this printing.',
    )
  })

  it('links back to the Index view it was opened from', async () => {
    const user = userEvent.setup()
    ownedMock.mockResolvedValue(TWO_LOTS)
    renderPrinting({
      pathname: '/index/bolt-lea',
      state: { indexSearch: '?finish=foil&page=2' },
    })

    await user.click(
      await screen.findByRole('link', { name: '← Back to the Index' }),
    )
    expect(
      screen.getByText('Landed on /index?finish=foil&page=2'),
    ).toBeInTheDocument()
  })

  it('hands each lot a way back here that keeps the Index view', async () => {
    const user = userEvent.setup()
    ownedMock.mockResolvedValue(TWO_LOTS)
    renderPrinting({
      pathname: '/index/bolt-lea',
      state: { indexSearch: '?finish=foil&page=2' },
    })

    const lots = await screen.findByRole('region', {
      name: 'Lots of this printing',
    })
    await user.click(
      within(lots).getAllByRole('link', { name: 'Lightning Bolt' })[0],
    )
    expect(screen.getByText('Landed on /catalog/7')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Back to /index/bolt-lea as Back to the printing with ?finish=foil&page=2',
      ),
    ).toBeInTheDocument()
  })

  it('links back to the bare Index when opened by URL', async () => {
    ownedMock.mockResolvedValue(TWO_LOTS)
    renderPrinting()
    expect(
      await screen.findByRole('link', { name: '← Back to the Index' }),
    ).toHaveAttribute('href', '/index')
  })

  it('says so when none of the printing is owned, and still sums the card', async () => {
    ownedMock.mockResolvedValue(
      owned({
        lots: [],
        total_quantity: 0,
        across_printings: across({ total_quantity: 2, printing_count: 2 }),
      }),
    )
    renderPrinting()

    expect(
      await screen.findByText('None of this printing is in the collection.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(
      screen.getByRole('complementary', { name: 'Ownership across printings' }),
    ).toBeInTheDocument()
  })

  it('shows "No such printing" when the catalog does not hold the id', async () => {
    ownedMock.mockRejectedValue(new ApiError('not in the catalog', 404))
    renderPrinting('/index/nope')

    expect(
      await screen.findByRole('heading', { name: 'No such printing' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Back to the Index' }),
    ).toHaveAttribute('href', '/index')
  })

  it('shows "No such printing" when the answer carries no card', async () => {
    ownedMock.mockResolvedValue(owned({ card: null, lots: [] }))
    renderPrinting()
    expect(
      await screen.findByRole('heading', { name: 'No such printing' }),
    ).toBeInTheDocument()
  })

  it('surfaces any other read failure as an alert', async () => {
    ownedMock.mockRejectedValue(new ApiError('database is locked', 500))
    renderPrinting()
    await waitFor(() =>
      expect(screen.getAllByRole('alert')[0]).toHaveTextContent(
        'database is locked',
      ),
    )
  })
})
