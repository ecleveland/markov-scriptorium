import { screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { InventoryLot } from '../api'
import { lot } from '../test/fixtures'
import { renderWithQuery } from '../test/queryWrapper'
import { LotRow } from './LotRow'

function renderRow(record: InventoryLot) {
  return renderWithQuery(
    <MemoryRouter>
      <table>
        <tbody>
          <LotRow lot={record} />
        </tbody>
      </table>
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
})
