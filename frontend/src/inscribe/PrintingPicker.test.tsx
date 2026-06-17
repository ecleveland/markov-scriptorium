import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CardPrinting, PrintingsResult } from '../api'
import { PrintingPicker } from './PrintingPicker'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return { ...actual, searchPrintings: vi.fn() }
})

import { searchPrintings } from '../api'

const searchMock = vi.mocked(searchPrintings)

function printing(overrides: Partial<CardPrinting>): CardPrinting {
  return {
    scryfall_id: 'lea-bolt',
    name: 'Lightning Bolt',
    set_code: 'lea',
    set_name: 'Limited Edition Alpha',
    collector_number: '161',
    rarity: 'common',
    finishes: ['nonfoil'],
    image_uris: null,
    ...overrides,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

afterEach(() => vi.clearAllMocks())

describe('PrintingPicker', () => {
  it('shows a loading state until printings arrive', async () => {
    const d = deferred<PrintingsResult>()
    searchMock.mockReturnValue(d.promise)

    render(
      <PrintingPicker name="Sol Ring" onPick={vi.fn()} onCancel={vi.fn()} />,
    )
    expect(screen.getByText(/Consulting the catalog/)).toBeInTheDocument()

    d.resolve({ printings: [printing({ name: 'Sol Ring' })], truncated: false })
    expect(
      await screen.findByRole('button', { name: /Limited Edition Alpha/ }),
    ).toBeInTheDocument()
  })

  it('shows an empty state when the card has no printings', async () => {
    searchMock.mockResolvedValue({ printings: [], truncated: false })
    render(
      <PrintingPicker name="Nonesuch" onPick={vi.fn()} onCancel={vi.fn()} />,
    )
    expect(
      await screen.findByText(/No printings of this card/),
    ).toBeInTheDocument()
  })

  it('shows an error state (and logs) when the lookup fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    searchMock.mockRejectedValue(new Error('offline'))

    render(
      <PrintingPicker name="Sol Ring" onPick={vi.fn()} onCancel={vi.fn()} />,
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /could not be loaded/i,
    )
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('warns when the result set was truncated', async () => {
    searchMock.mockResolvedValue({ printings: [printing({})], truncated: true })
    render(<PrintingPicker name="Forest" onPick={vi.fn()} onCancel={vi.fn()} />)
    expect(await screen.findByText(/refine the name/i)).toBeInTheDocument()
  })

  it('invokes onCancel when "Change card" is clicked', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    searchMock.mockResolvedValue({
      printings: [printing({})],
      truncated: false,
    })

    render(
      <PrintingPicker name="Sol Ring" onPick={vi.fn()} onCancel={onCancel} />,
    )
    await waitFor(() => expect(searchMock).toHaveBeenCalled())
    await user.click(screen.getByRole('button', { name: 'Change card' }))
    expect(onCancel).toHaveBeenCalledOnce()
  })
})
