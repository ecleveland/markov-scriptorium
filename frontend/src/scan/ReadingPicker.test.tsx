import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReadingPicker } from './ReadingPicker'

const READINGS = [
  { name: 'Sol Ring', confidence: 0.914 },
  { name: 'Lightning Bolt', confidence: 0.42 },
]

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

  it('picks the name of the reading clicked', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    render(<ReadingPicker readings={READINGS} onPick={onPick} />)

    await user.click(screen.getByRole('button', { name: /Lightning Bolt/ }))
    expect(onPick).toHaveBeenCalledWith('Lightning Bolt')
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
          { name: 'Forest', confidence: 0.8 },
          { name: 'Forest', confidence: 0.3 },
        ]}
        onPick={vi.fn()}
      />,
    )

    expect(screen.getAllByRole('button', { name: /Forest/ })).toHaveLength(2)
    expect(consoleError).not.toHaveBeenCalled()
  })
})
