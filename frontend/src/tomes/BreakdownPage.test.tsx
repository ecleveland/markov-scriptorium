import { focusManager } from '@tanstack/react-query'
import { act, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Breakdown } from '../api'
import { across, breakdownLine, deck } from '../test/fixtures'
import { renderWithQuery } from '../test/queryWrapper'
import { BreakdownPage } from './BreakdownPage'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return { ...actual, getDeck: vi.fn(), getBreakdown: vi.fn() }
})

import { ApiError, getBreakdown, getDeck } from '../api'

const deckMock = vi.mocked(getDeck)
const breakdownMock = vi.mocked(getBreakdown)

function renderPage() {
  return renderWithQuery(
    <MemoryRouter initialEntries={['/tomes/4/breakdown']}>
      <Routes>
        <Route path="/tomes/:deckId/breakdown" element={<BreakdownPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

const ring = breakdownLine({
  id: 1,
  board: 'commander',
  scryfall_id: 'ring',
  quantity: 1,
  owned: 1,
  available: 1,
  have: 1,
  needed: 0,
  card: { name: 'Sol Ring', set_code: 'c21', set_name: 'Commander 2021' },
})
const bolt = breakdownLine({
  id: 2,
  board: 'main',
  quantity: 4,
  owned: 1,
  available: 1,
  have: 1,
  needed: 3,
  swap_hint: across({
    printings: [
      {
        scryfall_id: 'bolt-lea',
        set_code: 'lea',
        set_name: 'Limited Edition Alpha',
        collector_number: '161',
        rarity: 'common',
        quantity: 1,
        lots: 1,
        reserved: 1,
        available: 0,
      },
      {
        scryfall_id: 'bolt-2x2',
        set_code: '2x2',
        set_name: 'Double Masters 2022',
        collector_number: '117',
        rarity: 'uncommon',
        quantity: 4,
        lots: 1,
        reserved: 1,
        available: 3,
      },
    ],
  }),
})

const result: Breakdown = {
  deck_id: 4,
  lines: [ring, bolt],
  totals: { cards: 5, have: 2, needed: 3 },
}

afterEach(() => vi.clearAllMocks())

describe('BreakdownPage', () => {
  it('heads the page with the Tome and its totals', async () => {
    deckMock.mockResolvedValue({ ...deck({ id: 4 }), cards: [] })
    breakdownMock.mockResolvedValue(result)
    renderPage()

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Edgar Markov' }),
    ).toBeInTheDocument()
    const tally = await screen.findByText(
      'Five cards, two in hand, three needed.',
    )
    expect(tally).toHaveClass('tome__tally')
    expect(
      screen.getByRole('link', { name: 'Back to the Tome' }),
    ).toHaveAttribute('href', '/tomes/4')
  })

  it('tallies each line as in hand or needed, grouped by board', async () => {
    deckMock.mockResolvedValue({ ...deck({ id: 4 }), cards: [] })
    breakdownMock.mockResolvedValue(result)
    renderPage()

    const commander = await screen.findByRole('region', { name: 'Commander' })
    expect(within(commander).getByRole('heading', { level: 3 })).toHaveClass(
      'opening',
    )
    expect(
      commander.querySelector('.tome-board__count .ledger__figure'),
    ).toHaveTextContent(/^1$/)
    expect(commander.querySelector('.ledger__note')).toHaveTextContent(
      /^in hand$/,
    )
    expect(
      commander.querySelector('.ledger__count .ledger__figure'),
    ).toHaveTextContent(/^1$/)
    expect(commander.querySelector('.tag')).toBeNull()

    const main = screen.getByRole('region', { name: 'Main' })
    expect(
      main.querySelector('.tome-board__count .ledger__figure'),
    ).toHaveTextContent(/^4$/)
    expect(main.querySelector('.ledger__name')).toHaveTextContent(
      '4× Lightning Bolt',
    )
    expect(main.querySelector('.ledger__where')).toHaveTextContent(
      /^Limited Edition Alpha, no\. 161\.$/,
    )
    // The figure is what is in hand; the note says so once, then what is needed.
    expect(main.querySelector('.ledger__count')).toHaveTextContent(
      /^1in hand, 3 needed$/,
    )
    expect(main.querySelector('.ledger__note')).toHaveTextContent(
      /^in hand, 3 needed$/,
    )
    expect(main.querySelector('.ledger__count .visually-hidden')).toBeNull()
  })

  it('numbers the lines on across the boards', async () => {
    deckMock.mockResolvedValue({ ...deck({ id: 4 }), cards: [] })
    breakdownMock.mockResolvedValue(result)
    renderPage()

    await screen.findByRole('list', { name: 'Main tally' })
    expect(screen.getByRole('list', { name: 'Commander tally' }).tagName).toBe(
      'OL',
    )
    const numbers = [...document.querySelectorAll('.ledger__number')].map(
      (n) => n.textContent,
    )
    expect(numbers).toEqual(['1', '2'])
  })

  it('names the finish of a foil line after the card', async () => {
    deckMock.mockResolvedValue({ ...deck({ id: 4 }), cards: [] })
    breakdownMock.mockResolvedValue({
      ...result,
      lines: [{ ...ring, finish: 'foil' }],
    })
    renderPage()

    expect(await screen.findByText('foil')).toHaveClass('finish-word')
  })

  it('points a needed line at the free copies in other printings', async () => {
    deckMock.mockResolvedValue({ ...deck({ id: 4 }), cards: [] })
    breakdownMock.mockResolvedValue(result)
    renderPage()

    const main = await screen.findByRole('region', { name: 'Main' })
    const hint = within(main).getByRole('note')
    expect(hint).toHaveTextContent(
      /^You own three free in other printings: three in Double Masters 2022, no\. 117\.$/,
    )
    expect(hint.closest('.ledger__aside')).not.toBeNull()
    // A printing with nothing free is no help, so it is not offered.
    expect(hint).not.toHaveTextContent('Limited Edition Alpha')
  })

  it('lists several free printings as one sentence', async () => {
    deckMock.mockResolvedValue({ ...deck({ id: 4 }), cards: [] })
    const [, doubleMasters] = bolt.swap_hint!.printings
    const free = (n: number, set_name: string, collector_number: string) => ({
      ...doubleMasters,
      scryfall_id: `bolt-${collector_number}`,
      set_name,
      collector_number,
      available: n,
    })
    breakdownMock.mockResolvedValue({
      ...result,
      lines: [
        {
          ...bolt,
          swap_hint: across({
            printings: [
              free(2, 'Double Masters 2022', '117'),
              free(1, 'Modern Horizons 2', '3'),
              free(1, 'Magic 2010', '146'),
            ],
          }),
        },
      ],
    })
    renderPage()

    expect(await screen.findByRole('note')).toHaveTextContent(
      'You own four free in other printings: two in Double Masters 2022, no. 117, one in Modern Horizons 2, no. 3 and one in Magic 2010, no. 146.',
    )
  })

  it("does not offer the line's own printing as another one", async () => {
    deckMock.mockResolvedValue({ ...deck({ id: 4 }), cards: [] })
    const own = bolt.swap_hint!.printings[0]
    breakdownMock.mockResolvedValue({
      ...result,
      lines: [
        {
          ...bolt,
          swap_hint: across({
            printings: [{ ...own, available: 2 }, bolt.swap_hint!.printings[1]],
          }),
        },
      ],
    })
    renderPage()

    const hint = await screen.findByRole('note')
    expect(hint).toHaveTextContent('You own three free in other printings')
    expect(hint).not.toHaveTextContent('Limited Edition Alpha')
  })

  it('offers no hint when no other printing has a free copy', async () => {
    deckMock.mockResolvedValue({ ...deck({ id: 4 }), cards: [] })
    breakdownMock.mockResolvedValue({
      ...result,
      lines: [{ ...bolt, swap_hint: across({ printings: [] }) }],
    })
    renderPage()

    await screen.findByText('in hand, 3 needed', { selector: '.ledger__note' })
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })

  it('explains a Tome that does not exist', async () => {
    deckMock.mockRejectedValue(new ApiError('No Tome with id 4.', 404))
    breakdownMock.mockRejectedValue(new ApiError('No Tome with id 4.', 404))
    renderPage()
    expect(
      await screen.findByRole('heading', { name: 'No such Tome' }),
    ).toBeInTheDocument()
  })

  it('explains a breakdown that could not be read', async () => {
    deckMock.mockResolvedValue({ ...deck({ id: 4 }), cards: [] })
    breakdownMock.mockRejectedValue(new ApiError('The archive is on fire', 500))
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The breakdown could not be read.',
    )
  })

  it('keeps the breakdown on screen when a refresh fails', async () => {
    deckMock.mockResolvedValue({ ...deck({ id: 4 }), cards: [] })
    breakdownMock
      .mockResolvedValueOnce(result)
      .mockRejectedValue(new ApiError('The scriptorium is closed.', 503))
    renderPage()
    await screen.findByText('Five cards, two in hand, three needed.')

    act(() => {
      focusManager.setFocused(false)
      focusManager.setFocused(true)
    })

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The breakdown could not be refreshed. The scriptorium is closed.',
    )
    expect(
      screen.getByText('Five cards, two in hand, three needed.'),
    ).toBeInTheDocument()
    focusManager.setFocused(undefined)
  })
})
