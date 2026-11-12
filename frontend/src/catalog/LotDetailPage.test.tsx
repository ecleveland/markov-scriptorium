import { screen, waitFor, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { lot, owned } from '../test/fixtures'
import { renderWithQuery } from '../test/queryWrapper'
import { LotDetailPage } from './LotDetailPage'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return {
    ...actual,
    getLot: vi.fn(),
    updateLot: vi.fn(),
    deleteLot: vi.fn(),
    ownedForPrinting: vi.fn(),
  }
})

import {
  ApiError,
  deleteLot,
  getLot,
  ownedForPrinting,
  updateLot,
} from '../api'

const getMock = vi.mocked(getLot)
const updateMock = vi.mocked(updateLot)
const deleteMock = vi.mocked(deleteLot)
const ownedMock = vi.mocked(ownedForPrinting)

function PrintingLanded() {
  const { pathname, state } = useLocation()
  const indexSearch = (state as { indexSearch?: string } | null)?.indexSearch
  return (
    <p>
      Landed on {pathname} {String(indexSearch ?? '')}
    </p>
  )
}

function renderDetail(
  entry: string | { pathname: string; state: unknown } = '/catalog/7',
) {
  return renderWithQuery(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/catalog" element={<p>The Catalog list</p>} />
        <Route path="/catalog/:lotId" element={<LotDetailPage />} />
        <Route path="/index/:scryfallId" element={<PrintingLanded />} />
      </Routes>
    </MemoryRouter>,
  )
}

const PRINTING_BACK = {
  to: '/index/bolt-lea',
  label: 'Back to the printing',
  state: { indexSearch: '?finish=foil' },
}

afterEach(() => vi.clearAllMocks())

describe('LotDetailPage', () => {
  it('opens on a plate headed by the card name and its finish', async () => {
    getMock.mockResolvedValue(lot({ id: 7, finish: 'foil' }))
    ownedMock.mockResolvedValue(owned())
    renderDetail()

    const heading = await screen.findByRole('heading', {
      level: 1,
      name: 'Lightning Bolt foil',
    })
    expect(within(heading).getByText('foil')).toHaveClass('finish-word')
    const plate = heading.closest('header')
    expect(plate).toHaveClass('plate')
    expect(
      within(plate as HTMLElement).getByRole('img', {
        name: 'Lightning Bolt (no image in the catalog)',
      }),
    ).toBeInTheDocument()
    expect(within(plate as HTMLElement).queryByRole('button')).toBeNull()
  })

  it('heads a nonfoil plate with the name alone', async () => {
    getMock.mockResolvedValue(lot({ id: 7, finish: 'nonfoil' }))
    ownedMock.mockResolvedValue(owned())
    renderDetail()

    const heading = await screen.findByRole('heading', { level: 1 })
    expect(heading.textContent).toBe('Lightning Bolt')
  })

  it('gives the printing and rarity as the plate first line', async () => {
    getMock.mockResolvedValue(lot({ id: 7 }))
    ownedMock.mockResolvedValue(owned())
    renderDetail()

    expect(
      await screen.findByText('Limited Edition Alpha, no. 161, common.'),
    ).toHaveClass('plate__printing')
  })

  it('tells the folio in full as a run of prose', async () => {
    getMock.mockResolvedValue(
      lot({
        id: 7,
        quantity: 2,
        finish: 'foil',
        condition: 'LP',
        location: 'Red binder',
        acquired_at: '2026-03-01',
        price_paid: '4.50',
        folio: { owned: 2, reserved: 0, available: 2 },
      }),
    )
    ownedMock.mockResolvedValue(owned())
    renderDetail()

    expect(
      await screen.findByText(
        'Two copies, lightly played, in Red binder. Foil, in English. ' +
          'Acquired 2026-03-01 for 4.50. Not yet claimed by any Tome.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Copies')).toHaveValue(2)
    expect(screen.getByLabelText('Condition')).toHaveValue('LP')
    expect(screen.getByLabelText('Volume')).toHaveValue('Red binder')
  })

  it('calls a single unshelved copy so and spells out its language', async () => {
    getMock.mockResolvedValue(
      lot({ id: 7, quantity: 1, location: null, language: 'ja' }),
    )
    ownedMock.mockResolvedValue(owned())
    renderDetail()

    expect(
      await screen.findByText(
        'One copy, near mint, unshelved. Nonfoil, in Japanese. ' +
          'Not yet claimed by any Tome.',
      ),
    ).toBeInTheDocument()
  })

  it('names an etched finish', async () => {
    getMock.mockResolvedValue(lot({ id: 7, finish: 'etched' }))
    ownedMock.mockResolvedValue(owned())
    renderDetail()

    expect(await screen.findByText(/Etched, in English\./)).toBeInTheDocument()
  })

  it('says when it was acquired even with no price', async () => {
    getMock.mockResolvedValue(
      lot({ id: 7, acquired_at: '2026-03-01', price_paid: null }),
    )
    ownedMock.mockResolvedValue(owned())
    renderDetail()

    const line = await screen.findByText(/Acquired 2026-03-01\./)
    expect(line).not.toHaveTextContent(/ for /)
  })

  it('says what was paid even with no date', async () => {
    getMock.mockResolvedValue(
      lot({ id: 7, acquired_at: null, price_paid: '4.50' }),
    )
    ownedMock.mockResolvedValue(owned())
    renderDetail()

    expect(await screen.findByText(/Acquired for 4\.50\./)).toBeInTheDocument()
  })

  it('leaves out the acquisition when neither date nor price is known', async () => {
    getMock.mockResolvedValue(
      lot({ id: 7, acquired_at: null, price_paid: null }),
    )
    ownedMock.mockResolvedValue(owned())
    renderDetail()

    await screen.findByRole('heading', { level: 1 })
    expect(screen.queryByText(/Acquired/)).not.toBeInTheDocument()
  })

  it('says how much of the folio Tomes claim and how much is free', async () => {
    getMock.mockResolvedValue(
      lot({
        id: 7,
        quantity: 1,
        folio: { owned: 4, reserved: 3, available: 1 },
      }),
    )
    ownedMock.mockResolvedValue(owned())
    renderDetail()

    expect(
      await screen.findByText(
        'One copy, near mint, unshelved. Nonfoil, in English. ' +
          'Three of its four copies are claimed by Tomes. ' +
          'One copy free for another Tome.',
      ),
    ).toBeInTheDocument()
  })

  it('says no copy is free when Tomes claim the whole folio', async () => {
    getMock.mockResolvedValue(
      lot({
        id: 7,
        quantity: 2,
        folio: { owned: 2, reserved: 2, available: 0 },
      }),
    )
    ownedMock.mockResolvedValue(owned())
    renderDetail()

    expect(
      await screen.findByText(
        /Every copy is claimed by Tomes\. No copies free for another Tome\.$/,
      ),
    ).toBeInTheDocument()
  })

  it('offers no free count when no Tome claims a copy', async () => {
    getMock.mockResolvedValue(
      lot({ id: 7, folio: { owned: 1, reserved: 0, available: 1 } }),
    )
    ownedMock.mockResolvedValue(owned())
    renderDetail()

    await screen.findByRole('heading', { level: 1 })
    expect(screen.queryByText(/free for another Tome/)).not.toBeInTheDocument()
  })

  it('orders the leaf: plate, ownership, the amend opening, then removal', async () => {
    getMock.mockResolvedValue(lot({ id: 7 }))
    ownedMock.mockResolvedValue(owned())
    renderDetail()

    const plate = (await screen.findByRole('heading', { level: 1 })).closest(
      'header',
    ) as HTMLElement
    const ownership = await screen.findByRole('complementary', {
      name: 'Ownership across printings',
    })
    const amend = screen.getByRole('region', { name: 'Amend the entry' })
    const remove = screen.getByRole('button', {
      name: 'Remove from the collection',
    })

    const order = [plate, ownership, amend, remove]
    for (let i = 1; i < order.length; i++) {
      expect(
        order[i - 1].compareDocumentPosition(order[i]) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
    }
  })

  it('opens the edit form under a rubricated "Amend the entry"', async () => {
    getMock.mockResolvedValue(lot({ id: 7 }))
    ownedMock.mockResolvedValue(owned())
    renderDetail()

    const heading = await screen.findByRole('heading', {
      level: 2,
      name: 'Amend the entry',
    })
    expect(heading).toHaveClass('opening')
    const amend = screen.getByRole('region', { name: 'Amend the entry' })
    expect(within(amend).getByLabelText('Copies')).toBeInTheDocument()
    expect(within(amend).getByLabelText('Notes')).toBeInTheDocument()
    expect(
      within(amend).getByRole('button', { name: 'Amend' }),
    ).toBeInTheDocument()
  })

  it('amends the four mutable fields in one PATCH', async () => {
    const user = userEvent.setup()
    const record = lot({ id: 7, quantity: 2 })
    getMock.mockResolvedValue(record)
    ownedMock.mockResolvedValue(owned())
    updateMock.mockResolvedValue({ ...record, condition: 'MP' })
    renderDetail()

    await user.selectOptions(await screen.findByLabelText('Condition'), 'MP')
    await user.type(screen.getByLabelText('Volume'), 'Long box')
    await user.click(screen.getByRole('button', { name: 'Amend' }))

    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith(7, {
        quantity: 2,
        condition: 'MP',
        location: 'Long box',
        notes: null,
      }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent('Amended.')
  })

  // Every field, not just one: the Condition select was missed the first time
  // this was fixed precisely because the test only exercised Volume.
  it.each([
    [
      'Copies',
      async (user: UserEvent) =>
        user.type(screen.getByLabelText('Copies'), '3'),
    ],
    [
      'Condition',
      async (user: UserEvent) =>
        user.selectOptions(screen.getByLabelText('Condition'), 'MP'),
    ],
    [
      'Volume',
      async (user: UserEvent) =>
        user.type(screen.getByLabelText('Volume'), 'Box'),
    ],
    [
      'Notes',
      async (user: UserEvent) =>
        user.type(screen.getByLabelText('Notes'), 'signed'),
    ],
  ])(
    'drops the saved confirmation once %s is edited again',
    async (_field, edit) => {
      const user = userEvent.setup()
      const record = lot({ id: 7, quantity: 2 })
      getMock.mockResolvedValue(record)
      ownedMock.mockResolvedValue(owned())
      updateMock.mockResolvedValue(record)
      renderDetail()

      await user.click(await screen.findByRole('button', { name: 'Amend' }))
      expect(await screen.findByRole('status')).toHaveTextContent('Amended.')

      await edit(user)

      // Leaving it up would vouch for an edit that has not been sent.
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    },
  )

  it('clears a blanked volume back to null rather than an empty string', async () => {
    const user = userEvent.setup()
    const record = lot({ id: 7, location: 'Red binder' })
    getMock.mockResolvedValue(record)
    ownedMock.mockResolvedValue(owned())
    updateMock.mockResolvedValue(record)
    renderDetail()

    await user.clear(await screen.findByLabelText('Volume'))
    await user.click(screen.getByRole('button', { name: 'Amend' }))

    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith(
        7,
        expect.objectContaining({ location: null }),
      ),
    )
  })

  it('refuses a blanked quantity instead of silently writing one copy', async () => {
    const user = userEvent.setup()
    getMock.mockResolvedValue(lot({ id: 7, quantity: 12 }))
    ownedMock.mockResolvedValue(owned())
    renderDetail()

    await user.clear(await screen.findByLabelText('Copies'))
    await user.click(screen.getByRole('button', { name: 'Amend' }))

    expect(updateMock).not.toHaveBeenCalled()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('A folio holds at least one copy.')
    expect(alert).toHaveClass('notice--danger')
  })

  it('refuses a zero quantity, which the schema would reject anyway', async () => {
    // Distinct from the blank case: `required` is satisfied here, so the
    // component's own guard is the only thing standing between a typo and a
    // PATCH that overwrites 12 copies.
    const user = userEvent.setup()
    getMock.mockResolvedValue(lot({ id: 7, quantity: 12 }))
    ownedMock.mockResolvedValue(owned())
    renderDetail()

    const copies = await screen.findByLabelText('Copies')
    await user.clear(copies)
    await user.type(copies, '0')
    await user.click(screen.getByRole('button', { name: 'Amend' }))

    expect(updateMock).not.toHaveBeenCalled()
  })

  it('removes only after a second, explicit confirmation', async () => {
    const user = userEvent.setup()
    getMock.mockResolvedValue(lot({ id: 7 }))
    ownedMock.mockResolvedValue(owned())
    deleteMock.mockResolvedValue(undefined)
    renderDetail()

    await user.click(
      await screen.findByRole('button', {
        name: 'Remove from the collection',
      }),
    )
    expect(deleteMock).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Confirm removal' }))
    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith(7))
    expect(await screen.findByText('The Catalog list')).toBeInTheDocument()
  })

  it('does not re-read the lot it just deleted', async () => {
    const user = userEvent.setup()
    getMock.mockResolvedValue(lot({ id: 7 }))
    ownedMock.mockResolvedValue(owned())
    deleteMock.mockResolvedValue(undefined)
    renderDetail()

    await user.click(
      await screen.findByRole('button', {
        name: 'Remove from the collection',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Confirm removal' }))
    await screen.findByText('The Catalog list')

    // Invalidating `inventoryKeys.all` prefix-matches the deleted lot's key; if
    // its entry is not dropped first, the still-mounted query refetches a gone
    // id and caches the 404 under it.
    expect(getMock).toHaveBeenCalledTimes(1)
  })

  it('backs out of a removal without deleting anything', async () => {
    const user = userEvent.setup()
    getMock.mockResolvedValue(lot({ id: 7 }))
    ownedMock.mockResolvedValue(owned())
    renderDetail()

    await user.click(
      await screen.findByRole('button', {
        name: 'Remove from the collection',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Keep it' }))

    expect(deleteMock).not.toHaveBeenCalled()
    expect(
      screen.getByRole('button', { name: 'Remove from the collection' }),
    ).toBeInTheDocument()
  })

  it('links back to the first Catalog page when opened by URL', async () => {
    getMock.mockResolvedValue(lot({ id: 7 }))
    ownedMock.mockResolvedValue(owned())
    renderDetail()

    expect(
      await screen.findByRole('link', { name: 'Back to the Catalog' }),
    ).toHaveAttribute('href', '/catalog')
  })

  it('links back to the Catalog page that opened it', async () => {
    getMock.mockResolvedValue(lot({ id: 7 }))
    ownedMock.mockResolvedValue(owned())
    renderDetail({
      pathname: '/catalog/7',
      state: { back: { to: '/catalog?page=2', label: 'Back to the Catalog' } },
    })

    expect(
      await screen.findByRole('link', { name: 'Back to the Catalog' }),
    ).toHaveAttribute('href', '/catalog?page=2')
  })

  it('links back to the printing that opened it, with its Index view', async () => {
    const user = userEvent.setup()
    getMock.mockResolvedValue(lot({ id: 7 }))
    ownedMock.mockResolvedValue(owned())
    renderDetail({ pathname: '/catalog/7', state: { back: PRINTING_BACK } })

    await user.click(
      await screen.findByRole('link', { name: 'Back to the printing' }),
    )
    expect(
      screen.getByText('Landed on /index/bolt-lea ?finish=foil'),
    ).toBeInTheDocument()
  })

  it('returns to the printing that opened it after a removal', async () => {
    const user = userEvent.setup()
    getMock.mockResolvedValue(lot({ id: 7 }))
    ownedMock.mockResolvedValue(owned())
    deleteMock.mockResolvedValue(undefined)
    renderDetail({ pathname: '/catalog/7', state: { back: PRINTING_BACK } })

    await user.click(
      await screen.findByRole('button', {
        name: 'Remove from the collection',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Confirm removal' }))
    expect(
      await screen.findByText('Landed on /index/bolt-lea ?finish=foil'),
    ).toBeInTheDocument()
  })

  it('explains a lot that is gone instead of showing a broken page', async () => {
    getMock.mockRejectedValue(new ApiError('No inventory lot with id 7.', 404))
    ownedMock.mockResolvedValue(owned())
    renderDetail()

    expect(
      await screen.findByRole('heading', { name: 'No such folio' }),
    ).toBeInTheDocument()
  })

  it('links a gone lot back to the first Catalog page when opened by URL', async () => {
    getMock.mockRejectedValue(new ApiError('No inventory lot with id 7.', 404))
    ownedMock.mockResolvedValue(owned())
    renderDetail()

    await screen.findByRole('heading', { name: 'No such folio' })
    expect(
      screen.getByRole('link', { name: 'Back to the Catalog' }),
    ).toHaveAttribute('href', '/catalog')
  })

  it('links a gone lot back to the printing that opened it', async () => {
    const user = userEvent.setup()
    getMock.mockRejectedValue(new ApiError('No inventory lot with id 7.', 404))
    ownedMock.mockResolvedValue(owned())
    renderDetail({ pathname: '/catalog/7', state: { back: PRINTING_BACK } })

    await screen.findByRole('heading', { name: 'No such folio' })
    await user.click(screen.getByRole('link', { name: 'Back to the printing' }))
    expect(
      screen.getByText('Landed on /index/bolt-lea ?finish=foil'),
    ).toBeInTheDocument()
  })

  it('keeps the way back to the printing when the lot cannot be read', async () => {
    getMock.mockRejectedValue(new ApiError('database is locked', 500))
    ownedMock.mockResolvedValue(owned())
    renderDetail({ pathname: '/catalog/7', state: { back: PRINTING_BACK } })

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'database is locked',
    )
    expect(
      screen.getByRole('link', { name: 'Back to the printing' }),
    ).toHaveAttribute('href', '/index/bolt-lea')
  })

  it('treats a non-numeric lot id as no such folio, without calling the API', async () => {
    renderWithQuery(
      <MemoryRouter initialEntries={['/catalog/not-a-number']}>
        <Routes>
          <Route path="/catalog/:lotId" element={<LotDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(
      await screen.findByRole('heading', { name: 'No such folio' }),
    ).toBeInTheDocument()
    expect(getMock).not.toHaveBeenCalled()
  })
})
