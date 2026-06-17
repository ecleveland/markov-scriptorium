import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CardSearch } from './CardSearch'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return { ...actual, autocompleteNames: vi.fn() }
})

import { autocompleteNames } from '../api'

const autocompleteMock = vi.mocked(autocompleteNames)

afterEach(() => vi.clearAllMocks())

describe('CardSearch', () => {
  it('queries autocomplete as the user types and selects a suggestion', async () => {
    const user = userEvent.setup()
    autocompleteMock.mockResolvedValue(['Lightning Bolt', 'Lightning Helix'])
    const onSelect = vi.fn()

    render(<CardSearch onSelect={onSelect} />)
    await user.type(screen.getByLabelText('Card name'), 'light')

    const option = await screen.findByRole('button', {
      name: 'Lightning Helix',
    })
    await user.click(option)

    expect(onSelect).toHaveBeenCalledWith('Lightning Helix')
    // The query was passed through to the catalog.
    expect(autocompleteMock).toHaveBeenCalledWith(
      'light',
      expect.any(AbortSignal),
    )
  })

  it('surfaces an error when the catalog lookup fails', async () => {
    const user = userEvent.setup()
    autocompleteMock.mockRejectedValue(new Error('offline'))

    render(<CardSearch onSelect={vi.fn()} />)
    await user.type(screen.getByLabelText('Card name'), 'x')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /could not be reached/i,
    )
  })

  it('does not query for a blank input', async () => {
    const user = userEvent.setup()
    render(<CardSearch onSelect={vi.fn()} />)
    await user.type(screen.getByLabelText('Card name'), '   ')
    // Give the debounce time to (not) fire.
    await new Promise((resolve) => setTimeout(resolve, 250))
    expect(autocompleteMock).not.toHaveBeenCalled()
  })
})
