import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { slot } from '../test/fixtures'
import { renderWithQuery } from '../test/queryWrapper'
import { SlotStepper } from './SlotStepper'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return { ...actual, updateSlot: vi.fn(), getDeck: vi.fn() }
})

import { useQuery } from '@tanstack/react-query'
import { ApiError, getDeck, updateSlot, type DeckWithCards } from '../api'
import { deck } from '../test/fixtures'
import { tomeKeys } from './queryKeys'

const updateMock = vi.mocked(updateSlot)

afterEach(() => vi.clearAllMocks())

/** The stepper beside a live read of its Tome, the way the editor mounts it. */
function WithTome() {
  const query = useQuery({
    queryKey: tomeKeys.tome(4),
    queryFn: () => getDeck(4),
  })
  if (!query.isSuccess) return null
  return <SlotStepper slot={query.data.cards[0]} />
}

describe('SlotStepper', () => {
  it('steps up through the slot PATCH', async () => {
    const user = userEvent.setup()
    const record = slot({ id: 9, deck_id: 4, quantity: 2 })
    updateMock.mockResolvedValue({ ...record, quantity: 3 })
    renderWithQuery(<SlotStepper slot={record} />)

    await user.click(
      screen.getByRole('button', {
        name: 'Increase quantity of Lightning Bolt',
      }),
    )
    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith(4, 9, { quantity: 3 }),
    )
  })

  it('steps down, but not below one', async () => {
    const user = userEvent.setup()
    const record = slot({ id: 9, deck_id: 4, quantity: 2 })
    updateMock.mockResolvedValue({ ...record, quantity: 1 })
    renderWithQuery(<SlotStepper slot={record} />)

    await user.click(
      screen.getByRole('button', {
        name: 'Decrease quantity of Lightning Bolt',
      }),
    )
    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith(4, 9, { quantity: 1 }),
    )
  })

  it('is disabled at one copy', () => {
    renderWithQuery(<SlotStepper slot={slot({ quantity: 1 })} />)
    expect(
      screen.getByRole('button', {
        name: 'Decrease quantity of Lightning Bolt',
      }),
    ).toBeDisabled()
  })

  it.each(['commander', 'companion'] as const)(
    'renders nothing on the %s board',
    (board) => {
      const { container } = renderWithQuery(
        <SlotStepper slot={slot({ board })} />,
      )
      expect(container).toBeEmptyDOMElement()
    },
  )

  it('says why a step was refused', async () => {
    const user = userEvent.setup()
    updateMock.mockRejectedValue(
      new ApiError('Olivia already holds the other copies.', 409),
    )
    renderWithQuery(<SlotStepper slot={slot({ quantity: 2 })} />)

    await user.click(
      screen.getByRole('button', {
        name: 'Increase quantity of Lightning Bolt',
      }),
    )
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Olivia already holds the other copies.')
    expect(alert).toHaveClass('notice--danger')
  })

  it('stays disabled until the Tome has been read back', async () => {
    // Re-enabling as soon as the PATCH lands lets a quick second click send
    // the same stale quantity, and one increment is lost.
    const user = userEvent.setup()
    const record = slot({ id: 9, deck_id: 4, quantity: 2 })
    const tome = (quantity: number): DeckWithCards => ({
      ...deck({ id: 4 }),
      cards: [{ ...record, quantity }],
    })
    let finishRefetch: (value: DeckWithCards) => void = () => {}
    vi.mocked(getDeck)
      .mockResolvedValueOnce(tome(2))
      .mockImplementationOnce(
        () => new Promise((resolve) => (finishRefetch = resolve)),
      )
    updateMock.mockResolvedValue({ ...record, quantity: 3 })
    renderWithQuery(<WithTome />)

    const increase = await screen.findByRole('button', {
      name: 'Increase quantity of Lightning Bolt',
    })
    await user.click(increase)
    await waitFor(() => expect(getDeck).toHaveBeenCalledTimes(2))
    expect(increase).toBeDisabled()

    finishRefetch(tome(3))
    await waitFor(() => expect(increase).toBeEnabled())
    expect(screen.getByText('3')).toBeInTheDocument()
  })
})
