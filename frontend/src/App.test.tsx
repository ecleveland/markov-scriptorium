import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'

// StatusHeader probes /api/health on mount; CardSearch never fires without input.
vi.stubGlobal(
  'fetch',
  vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ database: 'ok' }),
  }),
)

afterEach(() => vi.clearAllMocks())

describe('App routing', () => {
  it('redirects the root path to the Inscribe view', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    )
    expect(
      screen.getByRole('heading', { name: 'Inscribe a Card' }),
    ).toBeInTheDocument()
  })

  it('renders the Inscribe view directly at /inscribe', () => {
    render(
      <MemoryRouter initialEntries={['/inscribe']}>
        <App />
      </MemoryRouter>,
    )
    expect(screen.getByLabelText('Card name')).toBeInTheDocument()
  })
})
