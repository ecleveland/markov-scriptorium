import type { Page, Route } from '@playwright/test'

// Hermetic backend stubs. The Scriptorium frontend talks to FastAPI under the
// `/api` prefix; in these tests we never boot that backend. Instead we fulfil
// every `/api/**` request in the browser with canned data, so the suite is
// fast, deterministic, and never touches Scryfall or a real database.
//
// The inventory endpoints keep mutable state for the life of one test, so the
// Catalog flow (adjust a quantity, amend a folio, remove it) behaves the way a
// real backend would across several requests.
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

interface CardDisplay {
  name: string
  set_code: string
  set_name: string
  collector_number: string
  rarity: string
  image_uris: Record<string, string> | null
}

interface LotStub {
  id: number
  scryfall_id: string
  quantity: number
  finish: string
  condition: string
  language: string
  location: string | null
  acquired_at: string | null
  price_paid: string | null
  notes: string | null
  tags: string[] | null
  card: CardDisplay
}

const BOLT_LEA: CardDisplay = {
  name: 'Lightning Bolt',
  set_code: 'lea',
  set_name: 'Limited Edition Alpha',
  collector_number: '161',
  rarity: 'common',
  image_uris: null,
}

const BOLT_2X2: CardDisplay = {
  name: 'Lightning Bolt',
  set_code: '2x2',
  set_name: 'Double Masters 2022',
  collector_number: '117',
  rarity: 'uncommon',
  image_uris: null,
}

const SOL_RING_CARD: CardDisplay = {
  name: SOL_RING_PRINTING.name,
  set_code: SOL_RING_PRINTING.set_code,
  set_name: SOL_RING_PRINTING.set_name,
  collector_number: SOL_RING_PRINTING.collector_number,
  rarity: SOL_RING_PRINTING.rarity,
  image_uris: null,
}

/** Which printings belong to one card, for the cross-printing summary. */
const ORACLE_OF: Record<string, string> = {
  'bolt-lea': 'oracle-lightning-bolt',
  'bolt-2x2': 'oracle-lightning-bolt',
  [SOL_RING_PRINTING.scryfall_id]: 'oracle-sol-ring',
}

function lot(overrides: Partial<LotStub> & { id: number }): LotStub {
  return {
    scryfall_id: 'bolt-lea',
    quantity: 1,
    finish: 'nonfoil',
    condition: 'NM',
    language: 'en',
    location: null,
    acquired_at: null,
    price_paid: null,
    notes: null,
    tags: null,
    card: BOLT_LEA,
    ...overrides,
  }
}

/** The collection every test starts from: two printings of one card, plus one
 *  other card, so the ownership summary has something to sum. */
function seedLots(): Map<number, LotStub> {
  const seeded = [
    lot({
      id: 1,
      scryfall_id: SOL_RING_PRINTING.scryfall_id,
      card: SOL_RING_CARD,
      location: 'Red binder',
    }),
    lot({ id: 2, scryfall_id: 'bolt-lea', card: BOLT_LEA, quantity: 2 }),
    lot({
      id: 3,
      scryfall_id: 'bolt-2x2',
      card: BOLT_2X2,
      quantity: 4,
      finish: 'foil',
    }),
  ]
  return new Map(seeded.map((record) => [record.id, record]))
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

/** Everything owned of one printing, plus the card-level cross-printing total. */
function ownedForPrinting(lots: Map<number, LotStub>, scryfallId: string) {
  const all = [...lots.values()]
  const here = all.filter((record) => record.scryfall_id === scryfallId)
  const oracle = ORACLE_OF[scryfallId] ?? null
  const family = all.filter(
    (record) => (ORACLE_OF[record.scryfall_id] ?? null) === oracle,
  )

  const byPrinting = new Map<string, { quantity: number; lots: number }>()
  for (const record of family) {
    const seen = byPrinting.get(record.scryfall_id) ?? { quantity: 0, lots: 0 }
    byPrinting.set(record.scryfall_id, {
      quantity: seen.quantity + record.quantity,
      lots: seen.lots + 1,
    })
  }

  const printings = [...byPrinting.entries()].map(([id, totals]) => {
    const card = family.find((record) => record.scryfall_id === id)!.card
    return {
      scryfall_id: id,
      set_code: card.set_code,
      set_name: card.set_name,
      collector_number: card.collector_number,
      rarity: card.rarity,
      ...totals,
    }
  })

  return {
    scryfall_id: scryfallId,
    card: here[0]?.card ?? null,
    lots: here,
    rollup: [],
    total_quantity: here.reduce((sum, record) => sum + record.quantity, 0),
    across_printings: {
      grouping: 'oracle_id',
      oracle_id: oracle,
      name: family[0]?.card.name ?? '',
      total_quantity: printings.reduce((sum, p) => sum + p.quantity, 0),
      printing_count: printings.length,
      printings,
    },
  }
}

/**
 * Register a single `/api/**` handler covering the health probe, the Inscribe
 * read/write path, and the Catalog's list, detail, amend and remove. Routes are
 * matched by pathname + method; anything unmatched gets a 404 so an unstubbed
 * call fails loudly instead of hitting the network.
 *
 * Call once per test, before `page.goto`.
 */
export async function stubApi(page: Page): Promise<void> {
  const lots = seedLots()
  let nextId = lots.size + 1

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
      const created = lot({
        ...body,
        id: nextId++,
        card: SOL_RING_CARD,
      })
      lots.set(created.id, created)
      return json(route, created, 201)
    }

    if (path === '/inventory' && method === 'GET') {
      const limit = Number(url.searchParams.get('limit') ?? 25)
      const offset = Number(url.searchParams.get('offset') ?? 0)
      // Newest first, matching the backend's ORDER BY i.id DESC.
      const ordered = [...lots.values()].sort((a, b) => b.id - a.id)
      return json(route, {
        results: ordered.slice(offset, offset + limit),
        total: ordered.length,
        limit,
        offset,
      })
    }

    const cardMatch = path.match(/^\/inventory\/card\/(.+)$/)
    if (cardMatch) {
      return json(
        route,
        ownedForPrinting(lots, decodeURIComponent(cardMatch[1])),
      )
    }

    const lotMatch = path.match(/^\/inventory\/(\d+)$/)
    if (lotMatch) {
      const id = Number(lotMatch[1])
      const record = lots.get(id)
      if (record === undefined) {
        return json(route, { detail: `No inventory lot with id ${id}.` }, 404)
      }
      if (method === 'GET') return json(route, record)
      if (method === 'PATCH') {
        const amended = { ...record, ...route.request().postDataJSON() }
        lots.set(id, amended)
        return json(route, amended)
      }
      if (method === 'DELETE') {
        lots.delete(id)
        return route.fulfill({ status: 204, body: '' })
      }
    }

    return json(route, { detail: `Unstubbed ${method} ${path}` }, 404)
  })
}
