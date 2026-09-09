import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { lot } from '../test/fixtures'
import { renderWithQuery } from '../test/queryWrapper'
import { QuantityStepper } from './QuantityStepper'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return { ...actual, updateLot: vi.fn() }
})

import { ApiError, updateLot } from '../api'

const updateMock = vi.mocked(updateLot)

afterEach(() => vi.clearAllMocks())

describe('QuantityStepper', () => {
  it('increments through PATCH with the next quantity', async () => {
    const user = userEvent.setup()
    const record = lot({ id: 7, quantity: 2 })
    updateMock.mockResolvedValue({ ...record, quantity: 3 })
    renderWithQuery(<QuantityStepper lot={record} />)

    await user.click(
      screen.getByRole('button', {
        name: 'Increase quantity of Lightning Bolt',
      }),
    )
    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith(7, { quantity: 3 }),
    )
  })

  it('decrements through PATCH with the previous quantity', async () => {
    const user = userEvent.setup()
    const record = lot({ id: 7, quantity: 2 })
    updateMock.mockResolvedValue({ ...record, quantity: 1 })
    renderWithQuery(<QuantityStepper lot={record} />)

    await user.click(
      screen.getByRole('button', {
        name: 'Decrease quantity of Lightning Bolt',
      }),
    )
    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith(7, { quantity: 1 }),
    )
  })

  it('will not step below one, since the schema forbids a zero-quantity lot', () => {
    renderWithQuery(<QuantityStepper lot={lot({ quantity: 1 })} />)
    expect(
      screen.getByRole('button', {
        name: 'Decrease quantity of Lightning Bolt',
      }),
    ).toBeDisabled()
  })

  it('says so when the adjustment did not save', async () => {
    const user = userEvent.setup()
    updateMock.mockRejectedValue(new ApiError('no such lot', 404))
    renderWithQuery(<QuantityStepper lot={lot({ quantity: 2 })} />)

    await user.click(
      screen.getByRole('button', {
        name: 'Increase quantity of Lightning Bolt',
      }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent('not saved')
  })
})
