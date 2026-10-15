import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { InventoryLot } from '../api'
import { lot } from '../test/fixtures'
import { renderWithQuery } from '../test/queryWrapper'
import { LotRow, type LotBack } from './LotRow'

function Landed() {
  return <p>Landed with {JSON.stringify(useLocation().state)}</p>
}

function renderRow(
  record: InventoryLot,
  { entry = '/catalog', back }: { entry?: string; back?: LotBack } = {},
) {
  return renderWithQuery(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/catalog/:lotId" element={<Landed />} />
        <Route
          path="*"
          element={
            <table>
              <tbody>
                <LotRow lot={record} back={back} />
              </tbody>
            </table>
          }
        />
      </Routes>
    </MemoryRouter>,
  )
}

describe('LotRow', () => {
  it('says how many copies Tomes hold and how many are free', () => {
    renderRow(
      lot({ quantity: 1, folio: { owned: 4, reserved: 3, available: 1 } }),
    )
    expect(screen.getByText('3 of 4 in Tomes · 1 free')).toBeInTheDocument()
  })

  it('stays quiet when no Tome holds a copy', () => {
    renderRow(
      lot({ quantity: 4, folio: { owned: 4, reserved: 0, available: 4 } }),
    )
    expect(screen.queryByText(/in Tomes/)).not.toBeInTheDocument()
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
