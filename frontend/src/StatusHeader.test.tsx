import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StatusHeader } from './StatusHeader'

function renderHeader(path = '/inscribe') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <StatusHeader />
    </MemoryRouter>,
  )
}

afterEach(() => vi.restoreAllMocks())

describe('StatusHeader', () => {
  it('renders the brand mark linking to Inscribe', () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})))
    renderHeader()

    const brand = screen.getByRole('link', { name: /the markov scriptorium/i })
    expect(brand).toHaveAttribute('href', '/inscribe')
  })

  it('renders the primary nav with the three onboarding links', () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})))
    renderHeader()

    const nav = screen.getByRole('navigation', { name: /primary/i })
    expect(nav).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Inscribe' })).toHaveAttribute(
      'href',
      '/inscribe',
    )
    expect(screen.getByRole('link', { name: 'Decklist' })).toHaveAttribute(
      'href',
      '/import/decklist',
    )
    expect(screen.getByRole('link', { name: 'CSV' })).toHaveAttribute(
      'href',
      '/import/csv',
    )
  })

  it('marks the link for the current route as active', () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})))
    renderHeader('/import/decklist')

    expect(screen.getByRole('link', { name: 'Decklist' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getByRole('link', { name: 'Inscribe' })).not.toHaveAttribute(
      'aria-current',
    )
  })

  it('probes /api/health on mount and reports the healthy catalog', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'ok', database: 'ok' }),
    })
    vi.stubGlobal('fetch', fetchMock)
    renderHeader()

    expect(fetchMock).toHaveBeenCalledWith('/api/health')

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent(/catalog ok/i)
    expect(status).toHaveAttribute('data-state', 'ok')
  })

  it('shows the consulting state until the probe resolves', () => {
    // A never-settling promise keeps the header in its pending state.
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})))
    renderHeader()

    const status = screen.getByRole('status')
    expect(status).toHaveTextContent(/consulting/i)
    expect(status).toHaveAttribute('data-state', 'pending')
  })

  it('reports an unreachable backend when the probe fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    renderHeader()

    await waitFor(() => {
      const status = screen.getByRole('status')
      expect(status).toHaveTextContent(/unreachable/i)
      expect(status).toHaveAttribute('data-state', 'error')
    })
  })
})
