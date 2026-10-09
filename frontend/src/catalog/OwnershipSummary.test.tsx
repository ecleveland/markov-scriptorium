import { screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { across, owned } from '../test/fixtures'
import { renderWithQuery } from '../test/queryWrapper'
import { OwnershipSummary } from './OwnershipSummary'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return { ...actual, ownedForPrinting: vi.fn() }
})

import { ApiError, ownedForPrinting } from '../api'

const ownedMock = vi.mocked(ownedForPrinting)

afterEach(() => vi.clearAllMocks())

describe('OwnershipSummary', () => {
  it('counts a card across every printing of it and breaks them down', async () => {
    ownedMock.mockResolvedValue(
      owned({
        across_printings: across({
          total_quantity: 7,
          printing_count: 2,
          printings: [
            {
              scryfall_id: 'bolt-lea',
              set_code: 'lea',
              set_name: 'Limited Edition Alpha',
              collector_number: '161',
              rarity: 'common',
              quantity: 3,
              lots: 1,
              reserved: 0,
              available: 3,
            },
            {
              scryfall_id: 'bolt-2x2',
              set_code: '2x2',
              set_name: 'Double Masters 2022',
              collector_number: '117',
              rarity: 'uncommon',
              quantity: 4,
              lots: 2,
              reserved: 0,
              available: 4,
            },
          ],
        }),
      }),
    )
    renderWithQuery(<OwnershipSummary scryfallId="bolt-lea" />)

    expect(
      await screen.findByText(
        'You own 7 copies of Lightning Bolt across 2 printings.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/4× Double Masters 2022 \(2X2 #117\)/),
    ).toBeInTheDocument()
  })

  it('notes how many copies of a printing Tomes hold, and only when some do', async () => {
    ownedMock.mockResolvedValue(
      owned({
        across_printings: across({
          total_quantity: 7,
          printing_count: 2,
          printings: [
            {
              scryfall_id: 'bolt-lea',
              set_code: 'lea',
              set_name: 'Limited Edition Alpha',
              collector_number: '161',
              rarity: 'common',
              quantity: 3,
              lots: 1,
              reserved: 2,
              available: 1,
            },
            {
              scryfall_id: 'bolt-2x2',
              set_code: '2x2',
              set_name: 'Double Masters 2022',
              collector_number: '117',
              rarity: 'uncommon',
              quantity: 4,
              lots: 2,
              reserved: 0,
              available: 4,
            },
          ],
        }),
      }),
    )
    renderWithQuery(<OwnershipSummary scryfallId="bolt-lea" />)

    const items = await screen.findAllByRole('listitem')
    expect(items[0]).toHaveTextContent(
      '3× Limited Edition Alpha (LEA #161) · 2 in Tomes',
    )
    expect(items[1]).toHaveTextContent('4× Double Masters 2022 (2X2 #117)')
    expect(items[1]).not.toHaveTextContent('in Tomes')
  })

  it('says "all in this printing" rather than "across 1 printing"', async () => {
    ownedMock.mockResolvedValue(
      owned({
        across_printings: across({ total_quantity: 1, printing_count: 1 }),
      }),
    )
    renderWithQuery(<OwnershipSummary scryfallId="bolt-lea" />)

    expect(
      await screen.findByText(
        'You own 1 copy of Lightning Bolt, all in this printing.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('surfaces a failed count instead of showing nothing', async () => {
    ownedMock.mockRejectedValue(new ApiError('catalog unreachable', 500))
    renderWithQuery(<OwnershipSummary scryfallId="bolt-lea" />)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'catalog unreachable',
    )
  })
})
