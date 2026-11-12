import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { InventoryLot } from '../api'
import { Ledger } from '../components'
import { lot } from '../test/fixtures'
import { renderWithQuery } from '../test/queryWrapper'
import { LotRow, type LotBack } from './LotRow'

function Landed() {
  return <p>Landed with {JSON.stringify(useLocation().state)}</p>
}

function renderRow(
  record: InventoryLot,
  {
    entry = '/catalog',
    back,
    number = 1,
  }: { entry?: string; back?: LotBack; number?: number } = {},
) {
  return renderWithQuery(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/catalog/:lotId" element={<Landed />} />
        <Route
          path="*"
          element={
            <Ledger aria-label="Lots">
              <LotRow lot={record} number={number} back={back} />
            </Ledger>
          }
        />
      </Routes>
    </MemoryRouter>,
  )
}

function entry() {
  return screen.getByRole('listitem')
}

describe('LotRow', () => {
  it('is one ledger entry carrying its running number', () => {
    const { container } = renderRow(lot(), { number: 26 })
    expect(entry()).toHaveClass('ledger__entry')
    expect(container.querySelector('.ledger__number')).toHaveTextContent('26')
  })

  it('says where the folio sits: the printing, then the Volume', () => {
    renderRow(lot({ location: 'Red binder' }))
    expect(
      screen.getByText('Limited Edition Alpha, no. 161. Red binder.'),
    ).toHaveClass('ledger__where')
  })

  it('calls a lot with no Volume unshelved', () => {
    renderRow(lot({ location: null }))
    expect(
      screen.getByText('Limited Edition Alpha, no. 161. Unshelved.'),
    ).toBeInTheDocument()
  })

  it('sets the finish word after the name of a foil', () => {
    renderRow(lot({ finish: 'foil' }))
    const name = within(entry()).getByRole('link', {
      name: 'Lightning Bolt',
    }).parentElement
    expect(name).toHaveTextContent('Lightning Bolt foil')
    expect(within(entry()).getByText('foil')).toHaveClass('finish-word')
  })

  it('sets no finish word after the name of a nonfoil', () => {
    renderRow(lot({ finish: 'nonfoil' }))
    expect(entry().querySelector('.finish-word')).toBeNull()
    expect(
      within(entry()).getByRole('link', { name: 'Lightning Bolt' })
        .parentElement,
    ).toHaveTextContent(/^Lightning Bolt$/)
  })

  it('carries the stepper as its one control', () => {
    renderRow(lot({ quantity: 2 }))
    expect(within(entry()).getAllByRole('button')).toHaveLength(2)
    expect(
      within(entry()).getByRole('button', {
        name: 'Increase quantity of Lightning Bolt',
      }),
    ).toBeInTheDocument()
    expect(entry().querySelector('.qty-stepper__value')).toHaveTextContent('2')
  })

  it('notes the condition in words when no Tome claims a copy', () => {
    renderRow(
      lot({
        condition: 'LP',
        quantity: 4,
        folio: { owned: 4, reserved: 0, available: 4 },
      }),
    )
    expect(screen.getByText('lightly played')).toHaveClass('ledger__note')
    expect(screen.queryByText(/in Tomes/)).not.toBeInTheDocument()
  })

  it('notes how much of the folio the Tomes hold', () => {
    renderRow(
      lot({ quantity: 1, folio: { owned: 4, reserved: 3, available: 1 } }),
    )
    expect(screen.getByText('near mint, 3 of 4 in Tomes')).toHaveClass(
      'ledger__note',
    )
  })

  it('hands the lot the Catalog page it was opened from', async () => {
    const user = userEvent.setup()
    renderRow(lot({ id: 7 }), { entry: '/catalog?page=2' })

    await user.click(screen.getByRole('link', { name: 'Lightning Bolt' }))
    expect(screen.getByText(/^Landed with/)).toHaveTextContent(
      '{"back":{"to":"/catalog?page=2","label":"Back to the Catalog"}}',
    )
  })

  it('forwards a back target the caller names, state and all', async () => {
    const user = userEvent.setup()
    const back = {
      to: '/index/bolt-lea',
      label: 'Back to the printing',
      state: { indexSearch: '?finish=foil' },
    }
    renderRow(lot({ id: 7 }), { entry: '/index/bolt-lea', back })

    await user.click(screen.getByRole('link', { name: 'Lightning Bolt' }))
    expect(screen.getByText(/^Landed with/)).toHaveTextContent(
      JSON.stringify({ back }),
    )
  })
})
