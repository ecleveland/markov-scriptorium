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
// The Tome endpoints (decks, their slots, and the breakdown) work the same way:
// decks and slots live in memory for one test, and the breakdown reads the
// stubbed lots to say how many copies each slot has.
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

/** Lightning Bolt from Alpha, so name searches can find a second card. */
export const BOLT_LEA_PRINTING = {
  scryfall_id: 'bolt-lea',
  name: 'Lightning Bolt',
  set_code: 'lea',
  set_name: 'Limited Edition Alpha',
  collector_number: '161',
  rarity: 'common',
  finishes: ['nonfoil'],
  image_uris: null,
}

/** The printings the stubbed catalog knows, for name search. */
const CATALOG_PRINTINGS = [SOL_RING_PRINTING, BOLT_LEA_PRINTING]

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

/** A lot as the API serves it: the stored record plus its folio counts. No
 *  stubbed Tome claims cards, so every copy of the folio is free. */
function served(record: LotStub, lots: Map<number, LotStub>) {
  const owned = [...lots.values()]
    .filter(
      (other) =>
        other.scryfall_id === record.scryfall_id &&
        other.finish === record.finish,
    )
    .reduce((sum, other) => sum + other.quantity, 0)
  return { ...record, folio: { owned, reserved: 0, available: owned } }
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

/** Type-line fields a slot's card carries beyond the display fields. */
const CARD_TYPES: Record<
  string,
  { type_line: string; mana_cost: string; cmc: number }
> = {
  'bolt-lea': { type_line: 'Instant', mana_cost: '{R}', cmc: 1 },
  'bolt-2x2': { type_line: 'Instant', mana_cost: '{R}', cmc: 1 },
  [SOL_RING_PRINTING.scryfall_id]: {
    type_line: 'Artifact',
    mana_cost: '{1}',
    cmc: 1,
  },
}

/** The card a slot shows, or undefined when the catalog lacks the printing. */
function slotCard(scryfallId: string) {
  const display: Record<string, CardDisplay> = {
    [SOL_RING_PRINTING.scryfall_id]: SOL_RING_CARD,
    'bolt-lea': BOLT_LEA,
    'bolt-2x2': BOLT_2X2,
  }
  const base = display[scryfallId]
  const types = CARD_TYPES[scryfallId]
  if (base === undefined || types === undefined) return undefined
  return { ...base, ...types }
}

interface DeckStub {
  id: number
  name: string
  format: string | null
  status: string
  claims_cards: boolean
  notes: string | null
  changelog: string | null
  created_at: string
  updated_at: string
}

interface SlotStub {
  id: number
  deck_id: number
  scryfall_id: string
  finish: string
  board: string
  quantity: number
}

const STUB_TIMESTAMP = '2026-10-01T00:00:00Z'

/** Display order of boards within a Tome. */
const BOARD_RANK: Record<string, number> = {
  commander: 0,
  companion: 1,
  main: 2,
  sideboard: 3,
  maybeboard: 4,
}

const SINGLE_COPY_BOARDS = ['commander', 'companion']
const SINGLE_COPY_DETAIL = 'A commander or companion slot holds one copy.'

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
      reserved: 0,
      available: totals.quantity,
    }
  })

  return {
    scryfall_id: scryfallId,
    card: here[0]?.card ?? null,
    lots: here.map((record) => served(record, lots)),
    rollup: [],
    reservations: [],
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
 * read/write path, the Catalog's list, detail, amend and remove, and the Tome
 * endpoints (deck CRUD, slot CRUD, breakdown). Routes are
 * matched by pathname + method; anything unmatched gets a 404 so an unstubbed
 * call fails loudly instead of hitting the network.
 *
 * Call once per test, before `page.goto`.
 */
export async function stubApi(page: Page): Promise<void> {
  const lots = seedLots()
  let nextId = lots.size + 1
  const decks = new Map<number, DeckStub>()
  const slots = new Map<number, SlotStub>()
  let nextDeckId = 1
  let nextSlotId = 1

  const missingDeck = (route: Route, id: number) =>
    json(route, { detail: `No Tome with id ${id}.` }, 404)

  /** A slot as the API serves it, with its card attached. */
  const servedSlot = (slot: SlotStub) => ({
    ...slot,
    card: slotCard(slot.scryfall_id),
  })

  /** A Tome's slots in display order: board, then card name, then id. */
  const orderedSlots = (deckId: number) =>
    [...slots.values()]
      .filter((slot) => slot.deck_id === deckId)
      .sort(
        (a, b) =>
          BOARD_RANK[a.board] - BOARD_RANK[b.board] ||
          (slotCard(a.scryfall_id)?.name ?? '').localeCompare(
            slotCard(b.scryfall_id)?.name ?? '',
          ) ||
          a.id - b.id,
      )

  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname.replace(/^\/api/, '')
    const method = route.request().method()

    if (path === '/health') {
      return json(route, { status: 'ok', database: 'ok' })
    }

    if (path === '/cards/autocomplete') {
      const q = (url.searchParams.get('q') ?? '').toLowerCase()
      const names = CATALOG_PRINTINGS.map((printing) => printing.name).filter(
        (name) => name.toLowerCase().includes(q),
      )
      return json(route, { names })
    }

    if (path === '/cards/search') {
      const q = (url.searchParams.get('q') ?? '').toLowerCase()
      const results = CATALOG_PRINTINGS.filter((printing) =>
        printing.name.toLowerCase().includes(q),
      )
      return json(route, {
        results,
        total: results.length,
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
      return json(route, served(created, lots), 201)
    }

    if (path === '/inventory' && method === 'GET') {
      const limit = Number(url.searchParams.get('limit') ?? 25)
      const offset = Number(url.searchParams.get('offset') ?? 0)
      // Newest first, matching the backend's ORDER BY i.id DESC.
      const ordered = [...lots.values()].sort((a, b) => b.id - a.id)
      return json(route, {
        results: ordered
          .slice(offset, offset + limit)
          .map((record) => served(record, lots)),
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
      if (method === 'GET') return json(route, served(record, lots))
      if (method === 'PATCH') {
        const amended = { ...record, ...route.request().postDataJSON() }
        lots.set(id, amended)
        return json(route, served(amended, lots))
      }
      if (method === 'DELETE') {
        lots.delete(id)
        return route.fulfill({ status: 204, body: '' })
      }
    }

    if (path === '/decks' && method === 'GET') {
      const listed = [...decks.values()]
        .sort((a, b) => b.id - a.id)
        .map((deck) => ({
          ...deck,
          card_count: [...slots.values()]
            .filter(
              (slot) => slot.deck_id === deck.id && slot.board !== 'maybeboard',
            )
            .reduce((sum, slot) => sum + slot.quantity, 0),
        }))
      return json(route, listed)
    }

    if (path === '/decks' && method === 'POST') {
      const body = route.request().postDataJSON()
      const format =
        typeof body.format === 'string' ? body.format.trim().toLowerCase() : ''
      const deck: DeckStub = {
        id: nextDeckId++,
        name: String(body.name).trim(),
        format: format === '' ? null : format,
        status: body.status ?? 'in_progress',
        claims_cards: body.claims_cards ?? true,
        notes: body.notes ?? null,
        changelog: body.changelog ?? null,
        created_at: STUB_TIMESTAMP,
        updated_at: STUB_TIMESTAMP,
      }
      decks.set(deck.id, deck)
      return json(route, deck, 201)
    }

    const deckMatch = path.match(/^\/decks\/(\d+)$/)
    if (deckMatch) {
      const id = Number(deckMatch[1])
      const deck = decks.get(id)
      if (deck === undefined) return missingDeck(route, id)
      if (method === 'GET') {
        return json(route, {
          ...deck,
          cards: orderedSlots(id).map(servedSlot),
        })
      }
      if (method === 'PATCH') {
        const amended = { ...deck, ...route.request().postDataJSON() }
        decks.set(id, amended)
        return json(route, amended)
      }
      if (method === 'DELETE') {
        decks.delete(id)
        for (const slot of orderedSlots(id)) slots.delete(slot.id)
        return route.fulfill({ status: 204, body: '' })
      }
    }

    const deckCardsMatch = path.match(/^\/decks\/(\d+)\/cards$/)
    if (deckCardsMatch && method === 'POST') {
      const deckId = Number(deckCardsMatch[1])
      if (!decks.has(deckId)) return missingDeck(route, deckId)
      const body = route.request().postDataJSON()
      const scryfallId: string = body.scryfall_id
      if (slotCard(scryfallId) === undefined) {
        return json(
          route,
          {
            detail: `No card with Scryfall ID '${scryfallId}' resides in the catalog.`,
          },
          404,
        )
      }
      const finish: string = body.finish ?? 'nonfoil'
      const board: string = body.board ?? 'main'
      const quantity: number = body.quantity ?? 1
      const existing = orderedSlots(deckId).find(
        (slot) =>
          slot.scryfall_id === scryfallId &&
          slot.finish === finish &&
          slot.board === board,
      )
      if (SINGLE_COPY_BOARDS.includes(board)) {
        if (existing !== undefined || quantity > 1) {
          return json(route, { detail: SINGLE_COPY_DETAIL }, 409)
        }
      }
      if (existing !== undefined) {
        existing.quantity += quantity
        return json(route, servedSlot(existing), 201)
      }
      const created: SlotStub = {
        id: nextSlotId++,
        deck_id: deckId,
        scryfall_id: scryfallId,
        finish,
        board,
        quantity,
      }
      slots.set(created.id, created)
      return json(route, servedSlot(created), 201)
    }

    const slotMatch = path.match(/^\/decks\/(\d+)\/cards\/(\d+)$/)
    if (slotMatch) {
      const deckId = Number(slotMatch[1])
      const slotId = Number(slotMatch[2])
      if (!decks.has(deckId)) return missingDeck(route, deckId)
      const slot = slots.get(slotId)
      if (slot === undefined || slot.deck_id !== deckId) {
        return json(route, { detail: `No slot with id ${slotId}.` }, 404)
      }
      if (method === 'PATCH') {
        const amended = { ...slot, ...route.request().postDataJSON() }
        slots.set(slotId, amended)
        return json(route, servedSlot(amended))
      }
      if (method === 'DELETE') {
        slots.delete(slotId)
        return route.fulfill({ status: 204, body: '' })
      }
    }

    const breakdownMatch = path.match(/^\/decks\/(\d+)\/breakdown$/)
    if (breakdownMatch && method === 'GET') {
      const deckId = Number(breakdownMatch[1])
      if (!decks.has(deckId)) return missingDeck(route, deckId)
      // Demand already served per folio, so two slots of one folio share its copies.
      const served = new Map<string, number>()
      const lines = orderedSlots(deckId)
        .filter((slot) => slot.board !== 'maybeboard')
        .map((slot) => {
          const owned = [...lots.values()]
            .filter(
              (record) =>
                record.scryfall_id === slot.scryfall_id &&
                record.finish === slot.finish,
            )
            .reduce((sum, record) => sum + record.quantity, 0)
          // No rival Tome claims copies in the stub, so all owned copies are free.
          const available = owned
          const key = `${slot.scryfall_id}|${slot.finish}`
          const taken = served.get(key) ?? 0
          const have = Math.min(slot.quantity, Math.max(0, available - taken))
          const needed = slot.quantity - have
          served.set(key, taken + slot.quantity)
          return {
            id: slot.id,
            board: slot.board,
            scryfall_id: slot.scryfall_id,
            finish: slot.finish,
            quantity: slot.quantity,
            owned,
            available,
            have,
            needed,
            card: slotCard(slot.scryfall_id),
            swap_hint:
              needed > 0
                ? ownedForPrinting(lots, slot.scryfall_id).across_printings
                : null,
          }
        })
      const sum = (pick: (line: (typeof lines)[number]) => number) =>
        lines.reduce((total, line) => total + pick(line), 0)
      return json(route, {
        deck_id: deckId,
        lines,
        totals: {
          cards: sum((line) => line.quantity),
          have: sum((line) => line.have),
          needed: sum((line) => line.needed),
        },
      })
    }

    return json(route, { detail: `Unstubbed ${method} ${path}` }, 404)
  })
}
