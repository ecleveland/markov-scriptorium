import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { CardPrinting } from '../api'
import { CandidatePicker } from './CandidatePicker'

function printing(overrides: Partial<CardPrinting>): CardPrinting {
  return {
    scryfall_id: 'id',
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

describe('CandidatePicker', () => {
  it('renders the given candidates without fetching the catalog', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(
      <CandidatePicker
        name="Lightning Bolt"
        candidates={[
          printing({ scryfall_id: 'a', set_name: 'Limited Edition Alpha' }),
          printing({
            scryfall_id: 'b',
            set_name: 'Magic 2010',
            set_code: 'm10',
          }),
        ]}
        selectedId={null}
        onPick={() => {}}
      />,
    )
    expect(screen.getByText(/Limited Edition Alpha/)).toBeInTheDocument()
    expect(screen.getByText(/Magic 2010/)).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('fires onPick with the chosen printing', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    const m10 = printing({
      scryfall_id: 'b',
      set_name: 'Magic 2010',
      set_code: 'm10',
    })
    render(
      <CandidatePicker
        name="Lightning Bolt"
        candidates={[printing({ scryfall_id: 'a' }), m10]}
        selectedId={null}
        onPick={onPick}
      />,
    )
    await user.click(screen.getByRole('button', { name: /Magic 2010/ }))
    expect(onPick).toHaveBeenCalledWith(m10)
  })

  it('marks the selected candidate', () => {
    render(
      <CandidatePicker
        name="Lightning Bolt"
        candidates={[
          printing({ scryfall_id: 'a' }),
          printing({ scryfall_id: 'b' }),
        ]}
        selectedId="b"
        onPick={() => {}}
      />,
    )
    const options = screen.getAllByRole('option')
    expect(options[0]).toHaveAttribute('aria-selected', 'false')
    expect(options[1]).toHaveAttribute('aria-selected', 'true')
  })
})
