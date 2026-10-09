import { screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { renderWithQuery } from './test/queryWrapper'

// StatusHeader probes /api/health on mount; CardSearch never fires without input.
vi.stubGlobal(
  'fetch',
  vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ database: 'ok' }),
  }),
)

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>()
  return {
    ...actual,
    listInventory: vi.fn(),
    getLot: vi.fn(),
    listDecks: vi.fn(),
    getDeck: vi.fn(),
    getBreakdown: vi.fn(),
  }
})

import {
  ApiError,
  getBreakdown,
  getDeck,
  getLot,
  listDecks,
  listInventory,
} from './api'

vi.mocked(listInventory).mockResolvedValue({
  results: [],
  total: 0,
  limit: 25,
  offset: 0,
})
// Routing is what this file asserts; the detail view's own states are covered
// in catalog/LotDetailPage.test.tsx.
vi.mocked(getLot).mockRejectedValue(new ApiError('gone', 404))
vi.mocked(listDecks).mockResolvedValue([])
vi.mocked(getDeck).mockRejectedValue(new ApiError('gone', 404))
vi.mocked(getBreakdown).mockRejectedValue(new ApiError('gone', 404))

function renderAt(path: string) {
  return renderWithQuery(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}

afterEach(() => vi.clearAllMocks())

describe('App routing', () => {
  it('redirects the root path to the Catalog', async () => {
    renderAt('/')
    expect(
      await screen.findByRole('heading', { name: 'The Catalog' }),
    ).toBeInTheDocument()
  })

  it('renders the Catalog directly at /catalog', async () => {
    renderAt('/catalog')
    expect(
      await screen.findByRole('heading', { name: 'The Catalog' }),
    ).toBeInTheDocument()
  })

  it('renders the Inscribe view at /inscribe', () => {
    renderAt('/inscribe')
    expect(screen.getByLabelText('Card name')).toBeInTheDocument()
  })

  it('renders the folio detail route at /catalog/:lotId', async () => {
    renderAt('/catalog/999')
    expect(
      await screen.findByRole('heading', { name: 'No such folio' }),
    ).toBeInTheDocument()
  })

  it('renders the Tomes list at /tomes', async () => {
    renderAt('/tomes')
    expect(
      await screen.findByRole('heading', { name: 'The Tomes' }),
    ).toBeInTheDocument()
  })

  it('renders the Tome editor route at /tomes/:deckId', async () => {
    renderAt('/tomes/999')
    expect(
      await screen.findByRole('heading', { name: 'No such Tome' }),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('Card name')).not.toBeInTheDocument()
  })

  it('renders the breakdown route at /tomes/:deckId/breakdown', async () => {
    renderAt('/tomes/999/breakdown')
    expect(
      await screen.findByRole('heading', { name: 'No such Tome' }),
    ).toBeInTheDocument()
    await waitFor(() => expect(getBreakdown).toHaveBeenCalledWith(999))
  })

  it('links the Tomes from the primary nav, after the Catalog', () => {
    renderAt('/inscribe')
    const nav = screen.getByRole('navigation', { name: 'Primary' })
    const links = within(nav)
      .getAllByRole('link')
      .map((link) => link.textContent)
    expect(links.slice(0, 2)).toEqual(['Catalog', 'Tomes'])
    expect(within(nav).getByRole('link', { name: 'Tomes' })).toHaveAttribute(
      'href',
      '/tomes',
    )
  })

  it('serves the component specimen sheet in development', async () => {
    // Vitest runs with DEV set, so the lazily loaded route is registered.
    // The wait covers React's fixed 300ms Suspense throttle plus a cold
    // worker's transform of the chunk, so the default 1s cannot flake.
    renderAt('/specimens')
    expect(
      await screen.findByRole(
        'heading',
        { name: 'Specimens' },
        { timeout: 5000 },
      ),
    ).toBeInTheDocument()
  })

  it('does not register the specimen sheet outside development', async () => {
    vi.stubEnv('DEV', false)
    vi.resetModules()
    try {
      const { default: ProdApp } = await import('./App')
      renderWithQuery(
        <MemoryRouter initialEntries={['/specimens']}>
          <ProdApp />
        </MemoryRouter>,
      )
      // The shell still renders. The route does not: with no match, Routes
      // renders nothing, so main is empty. A registered lazy route would
      // already have committed its Suspense fallback here, so this assertion
      // fails if the DEV gate is ever dropped.
      expect(
        await screen.findByRole('link', { name: /The Markov Scriptorium/ }),
      ).toBeInTheDocument()
      await vi.dynamicImportSettled()
      expect(screen.getByRole('main')).toBeEmptyDOMElement()
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
