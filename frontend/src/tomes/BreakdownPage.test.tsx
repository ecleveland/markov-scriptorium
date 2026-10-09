import { screen, within } from '@testing-library/react'
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
    expect(
      await screen.findByText('5 cards, 2 in hand, 3 needed'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /Back to the Tome/ }),
    ).toHaveAttribute('href', '/tomes/4')
  })

  it('tags each line as in hand or needed, grouped by board', async () => {
    deckMock.mockResolvedValue({ ...deck({ id: 4 }), cards: [] })
    breakdownMock.mockResolvedValue(result)
    renderPage()

    const commander = await screen.findByRole('region', {
      name: 'Commander · 1',
    })
    expect(within(commander).getByText('in hand')).toHaveClass('tag--success')
    const main = screen.getByRole('region', { name: 'Main · 4' })
    expect(within(main).getByText('3 needed')).toHaveClass('tag--warning')
    expect(main).toHaveTextContent('Limited Edition Alpha (LEA) · #161')
  })

  it('points a needed line at the free copies in other printings', async () => {
    deckMock.mockResolvedValue({ ...deck({ id: 4 }), cards: [] })
    breakdownMock.mockResolvedValue(result)
    renderPage()

    const main = await screen.findByRole('region', { name: 'Main · 4' })
    const hint = within(main).getByRole('note')
    expect(hint).toHaveTextContent('You own 3 free in other printings')
    expect(hint).toHaveTextContent('Double Masters 2022 (2X2) · #117')
    // A printing with nothing free is no help, so it is not offered.
    expect(hint).not.toHaveTextContent('Limited Edition Alpha')
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
    expect(hint).toHaveTextContent('You own 3 free in other printings')
    expect(hint).not.toHaveTextContent('Limited Edition Alpha')
  })

  it('offers no hint when no other printing has a free copy', async () => {
    deckMock.mockResolvedValue({ ...deck({ id: 4 }), cards: [] })
    breakdownMock.mockResolvedValue({
      ...result,
      lines: [{ ...bolt, swap_hint: across({ printings: [] }) }],
    })
    renderPage()

    await screen.findByText('3 needed')
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
})
