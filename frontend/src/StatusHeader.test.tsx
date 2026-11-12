import { render, screen, waitFor, within } from '@testing-library/react'
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

function stubHealth(database: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'ok', database }),
    }),
  )
}

afterEach(() => vi.restoreAllMocks())

describe('StatusHeader', () => {
  it('renders the brand mark linking home to the Index', () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})))
    renderHeader()

    const brand = screen.getByRole('link', { name: /the markov scriptorium/i })
    expect(brand).toHaveAttribute('href', '/index')
  })

  it('names the brand link with a comma, which screen readers pause on', () => {
    // Some engines read an em dash aloud as "dash".
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})))
    renderHeader()

    expect(
      screen.getByRole('link', { name: 'The Markov Scriptorium, home' }),
    ).toBeInTheDocument()
  })

  it('sets the running head in nav order, with Scry beside Inscribe', () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})))
    renderHeader()

    const nav = screen.getByRole('navigation', { name: 'Primary' })
    const links = within(nav)
      .getAllByRole('link')
      .map((link) => [link.textContent, link.getAttribute('href')])
    // Scrying is the other way to inscribe, so it sits beside Inscribe.
    expect(links).toEqual([
      ['The Index', '/index'],
      ['The Catalog', '/catalog'],
      ['Tomes', '/tomes'],
      ['Inscribe', '/inscribe'],
      ['Scry', '/scan'],
      ['Bring in', '/import'],
      ['Muniment Room', '/archive'],
    ])
  })

  it('marks Bring in as the current page on either import route', () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})))
    renderHeader('/import/csv')

    const nav = screen.getByRole('navigation', { name: 'Primary' })
    expect(within(nav).getByRole('link', { name: 'Bring in' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(
      within(nav).getByRole('link', { name: 'Inscribe' }),
    ).not.toHaveAttribute('aria-current')
  })

  it('probes /api/health on mount and reports the catalog open', async () => {
    stubHealth('ok')
    renderHeader()

    expect(fetch).toHaveBeenCalledWith('/api/health')

    await waitFor(() => {
      const status = screen.getByRole('status')
      expect(status).toHaveTextContent('the catalog is open')
      expect(status).toHaveAttribute('data-state', 'ok')
    })
  })

  it('consults the catalog until the probe resolves', () => {
    // A never-settling promise keeps the header in its pending state.
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})))
    renderHeader()

    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('consulting the catalog…')
    expect(status).toHaveAttribute('data-state', 'pending')
  })

  it('reports an error when the backend answers but the database does not', async () => {
    stubHealth('unavailable')
    renderHeader()

    await waitFor(() => {
      const status = screen.getByRole('status')
      expect(status).toHaveTextContent('the catalog could not be opened')
      expect(status).toHaveAttribute('data-state', 'error')
    })
  })

  it('reports an unreachable catalog when the probe fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    renderHeader()

    await waitFor(() => {
      const status = screen.getByRole('status')
      expect(status).toHaveTextContent('the catalog could not be reached')
      expect(status).toHaveAttribute('data-state', 'error')
    })
  })

  it('reports an unreachable catalog when the probe returns a server error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 503, json: vi.fn() }),
    )
    renderHeader()

    await waitFor(() => {
      const status = screen.getByRole('status')
      expect(status).toHaveTextContent('the catalog could not be reached')
      expect(status).toHaveAttribute('data-state', 'error')
    })
  })

  it('draws the candle dot without a glyph', () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})))
    const { container } = renderHeader()

    const dot = container.querySelector('.status-dot')
    expect(dot).toHaveAttribute('aria-hidden', 'true')
    expect(dot).toBeEmptyDOMElement()
  })
})
