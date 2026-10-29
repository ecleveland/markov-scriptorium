import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { describePrinting } from '../components/printing'
import { printing } from '../test/fixtures'
import { ReadingPicker } from './ReadingPicker'

const READINGS = [
  { name: 'Sol Ring', confidence: 0.914, printing: null },
  { name: 'Lightning Bolt', confidence: 0.42, printing: null },
]

const SOL_RING_C21 = printing({
  scryfall_id: 'sol-ring-c21',
  name: 'Sol Ring',
  set_code: 'c21',
  set_name: 'Commander 2021',
  collector_number: '263',
})

afterEach(() => vi.restoreAllMocks())

describe('ReadingPicker', () => {
  it('lists each reading with its confidence as a whole percent', () => {
    render(<ReadingPicker readings={READINGS} onPick={vi.fn()} />)

    const list = screen.getByRole('list', { name: 'Cards the glass read' })
    const options = within(list).getAllByRole('button')
    expect(options.map((option) => option.textContent)).toEqual([
      'Sol Ring 91%',
      'Lightning Bolt 42%',
    ])
    expect(options[0]).toHaveClass('listbox__option')
  })

  it('picks the reading clicked', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    render(<ReadingPicker readings={READINGS} onPick={onPick} />)

    await user.click(screen.getByRole('button', { name: /Lightning Bolt/ }))
    expect(onPick).toHaveBeenCalledWith(READINGS[1])
  })

  it('names the printing before the confidence when the glass read the corner', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    const pinned = {
      name: 'Sol Ring',
      confidence: 0.91,
      printing: SOL_RING_C21,
    }
    render(<ReadingPicker readings={[pinned, READINGS[1]]} onPick={onPick} />)

    const [solRing, bolt] = screen.getAllByRole('button')
    expect(solRing).toHaveTextContent(
      `Sol Ring ${describePrinting(SOL_RING_C21)} 91%`,
    )
    expect(
      within(solRing).getByText(describePrinting(SOL_RING_C21)),
    ).toHaveClass('reading-picker__printing')
    // A reading without a printing names only the card and the confidence.
    expect(bolt.textContent).toBe('Lightning Bolt 42%')
    expect(bolt.querySelector('.reading-picker__printing')).toBeNull()

    await user.click(solRing)
    expect(onPick).toHaveBeenCalledWith(pinned)
  })

  it('moves between readings with the arrow keys', async () => {
    const user = userEvent.setup()
    render(<ReadingPicker readings={READINGS} onPick={vi.fn()} />)

    screen.getByRole('button', { name: /Sol Ring/ }).focus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('button', { name: /Lightning Bolt/ })).toHaveFocus()
  })

  it('lists a name read twice as two options', () => {
    // The contract does not promise one reading per name.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <ReadingPicker
        readings={[
          { name: 'Forest', confidence: 0.8, printing: null },
          { name: 'Forest', confidence: 0.3, printing: null },
        ]}
        onPick={vi.fn()}
      />,
    )

    expect(screen.getAllByRole('button', { name: /Forest/ })).toHaveLength(2)
    expect(consoleError).not.toHaveBeenCalled()
  })
})
