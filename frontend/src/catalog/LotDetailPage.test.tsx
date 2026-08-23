import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
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

function renderDetail(lotId = 7) {
  return renderWithQuery(
    <MemoryRouter initialEntries={[`/catalog/${lotId}`]}>
      <Routes>
        <Route path="/catalog" element={<p>The Catalog list</p>} />
        <Route path="/catalog/:lotId" element={<LotDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

afterEach(() => vi.clearAllMocks())

describe('LotDetailPage', () => {
  it('shows the folio in full', async () => {
    getMock.mockResolvedValue(
      lot({
        id: 7,
        quantity: 2,
        finish: 'foil',
        condition: 'LP',
        location: 'Red binder',
        acquired_at: '2026-03-01',
        price_paid: '4.50',
      }),
    )
    ownedMock.mockResolvedValue(owned())
    renderDetail()

    expect(
      await screen.findByRole('heading', { name: 'Lightning Bolt' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Limited Edition Alpha · LEA #161 · common/),
    ).toBeInTheDocument()
    expect(screen.getByText('foil')).toBeInTheDocument()
    expect(screen.getByText('2026-03-01')).toBeInTheDocument()
    expect(screen.getByLabelText('Copies')).toHaveValue(2)
    expect(screen.getByLabelText('Condition')).toHaveValue('LP')
    expect(screen.getByLabelText('Volume')).toHaveValue('Red binder')
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
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A folio holds at least one copy.',
    )
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

  it('explains a lot that is gone instead of showing a broken page', async () => {
    getMock.mockRejectedValue(new ApiError('No inventory lot with id 7.', 404))
    ownedMock.mockResolvedValue(owned())
    renderDetail()

    expect(
      await screen.findByRole('heading', { name: 'No such folio' }),
    ).toBeInTheDocument()
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
