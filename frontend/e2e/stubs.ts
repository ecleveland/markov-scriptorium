import type { Page, Route } from '@playwright/test'

// Hermetic backend stubs. The Scriptorium frontend talks to FastAPI under the
// `/api` prefix; in these tests we never boot that backend. Instead we fulfil
// every `/api/**` request in the browser with canned data, so the suite is
// fast, deterministic, and never touches Scryfall or a real database.
//
// Shapes mirror frontend/src/api.ts. Keep them in sync if the contracts change.

/** A single catalog printing — enough fields for the Inscribe flow. */
export const SOL_RING_PRINTING = {
  scryfall_id: 'sol-ring-c21-263',
  name: 'Sol Ring',
  set_code: 'c21',
  set_name: 'Commander 2021',
  collector_number: '263',
  rarity: 'uncommon',
  finishes: ['nonfoil', 'foil'],
  image_uris: null,
}

/** The inventory lot returned by a successful `POST /api/inventory`. */
function inventoryLot(body: {
  scryfall_id: string
  quantity: number
  finish: string
  condition: string
  location?: string | null
}) {
  return {
    id: 1,
    scryfall_id: body.scryfall_id,
    quantity: body.quantity,
    finish: body.finish,
    condition: body.condition,
    location: body.location ?? null,
    card: {
      name: SOL_RING_PRINTING.name,
      set_code: SOL_RING_PRINTING.set_code,
      set_name: SOL_RING_PRINTING.set_name,
      collector_number: SOL_RING_PRINTING.collector_number,
      image_uris: null,
    },
  }
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

/**
 * Register a single `/api/**` handler covering the health probe and the Inscribe
 * read/write path. Routes are matched by pathname + method; anything unmatched
 * gets a 404 so an unstubbed call fails loudly instead of hitting the network.
 *
 * Call once per test, before `page.goto`.
 */
export async function stubApi(page: Page): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname.replace(/^\/api/, '')
    const method = route.request().method()

    if (path === '/health') {
      return json(route, { status: 'ok', database: 'ok' })
    }

    if (path === '/cards/autocomplete') {
      const q = (url.searchParams.get('q') ?? '').toLowerCase()
      const names = SOL_RING_PRINTING.name.toLowerCase().includes(q)
        ? [SOL_RING_PRINTING.name]
        : []
      return json(route, { names })
    }

    if (path === '/cards/search') {
      return json(route, {
        results: [SOL_RING_PRINTING],
        total: 1,
        limit: Number(url.searchParams.get('limit') ?? 100),
        offset: 0,
      })
    }

    if (path === '/inventory' && method === 'POST') {
      const body = route.request().postDataJSON()
      return json(route, inventoryLot(body), 201)
    }

    return json(route, { detail: `Unstubbed ${method} ${path}` }, 404)
  })
}
