import { screen } from '@testing-library/react'
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
  return { ...actual, listInventory: vi.fn(), getLot: vi.fn() }
})

import { ApiError, getLot, listInventory } from './api'

vi.mocked(listInventory).mockResolvedValue({
  results: [],
  total: 0,
  limit: 25,
  offset: 0,
})
// Routing is what this file asserts; the detail view's own states are covered
// in catalog/LotDetailPage.test.tsx.
vi.mocked(getLot).mockRejectedValue(new ApiError('gone', 404))

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

  it('serves the component specimen sheet in development', async () => {
    // Vitest runs with DEV set, so the lazily loaded route is registered.
    renderAt('/specimens')
    expect(
      await screen.findByRole('heading', { name: 'Specimens' }),
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
      // The shell still renders. The route does not.
      expect(
        await screen.findByRole('link', { name: /The Markov Scriptorium/ }),
      ).toBeInTheDocument()
      expect(
        screen.queryByRole('heading', { name: 'Specimens' }),
      ).not.toBeInTheDocument()
    } finally {
      vi.unstubAllEnvs()
      vi.resetModules()
    }
  })
})
