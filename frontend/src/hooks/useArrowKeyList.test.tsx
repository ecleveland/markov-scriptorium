import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { useArrowKeyList } from './useArrowKeyList'

function TestList() {
  return (
    <>
      <button type="button">Outside</button>
      <ul aria-label="Choices" {...useArrowKeyList()}>
        {['First', 'Second', 'Third'].map((label) => (
          <li key={label}>
            <button type="button" className="listbox__option">
              {label}
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}

function option(name: string) {
  return screen.getByRole('button', { name })
}

describe('useArrowKeyList', () => {
  it('moves focus to the next option on ArrowDown', async () => {
    const user = userEvent.setup()
    render(<TestList />)
    option('First').focus()
    await user.keyboard('{ArrowDown}')
    expect(option('Second')).toHaveFocus()
  })

  it('wraps from the last option to the first on ArrowDown', async () => {
    const user = userEvent.setup()
    render(<TestList />)
    option('Third').focus()
    await user.keyboard('{ArrowDown}')
    expect(option('First')).toHaveFocus()
  })

  it('wraps from the first option to the last on ArrowUp', async () => {
    const user = userEvent.setup()
    render(<TestList />)
    option('First').focus()
    await user.keyboard('{ArrowUp}')
    expect(option('Third')).toHaveFocus()
  })

  it('jumps to the ends on Home and End', async () => {
    const user = userEvent.setup()
    render(<TestList />)
    option('Second').focus()
    await user.keyboard('{End}')
    expect(option('Third')).toHaveFocus()
    await user.keyboard('{Home}')
    expect(option('First')).toHaveFocus()
  })

  it('prevents the page scroll for the arrow keys only', () => {
    render(<TestList />)
    option('First').focus()
    const arrow = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
      cancelable: true,
    })
    option('First').dispatchEvent(arrow)
    expect(arrow.defaultPrevented).toBe(true)

    const letter = new KeyboardEvent('keydown', {
      key: 'a',
      bubbles: true,
      cancelable: true,
    })
    option('Second').dispatchEvent(letter)
    expect(letter.defaultPrevented).toBe(false)
    expect(option('Second')).toHaveFocus()
  })

  it('starts from the first option when focus is outside the list', () => {
    render(<TestList />)
    option('Outside').focus()
    // Dispatched on the list itself: the focused element sits outside it.
    screen
      .getByRole('list', { name: 'Choices' })
      .dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
      )
    expect(option('First')).toHaveFocus()
  })
})
