import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ApiError,
  autocompleteNames,
  inscribe,
  inscribeBulk,
  parseDecklist,
  resolveDecklist,
  searchPrintings,
  type CardPrinting,
} from './api'

function mockFetch(body: unknown, ok = true, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve(body),
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function printing(overrides: Partial<CardPrinting>): CardPrinting {
  return {
    scryfall_id: 'id',
    name: 'Lightning Bolt',
    set_code: 'lea',
    set_name: 'Limited Edition Alpha',
    collector_number: '161',
    rarity: 'common',
    finishes: ['nonfoil'],
    image_uris: null,
    ...overrides,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('autocompleteNames', () => {
  it('returns [] without calling the API for a blank query', async () => {
    const fetchMock = mockFetch({ names: [] })
    expect(await autocompleteNames('   ')).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('queries the autocomplete endpoint and unwraps names', async () => {
    const fetchMock = mockFetch({
      names: ['Lightning Bolt', 'Lightning Helix'],
    })
    const names = await autocompleteNames('light')
    expect(names).toEqual(['Lightning Bolt', 'Lightning Helix'])
    expect(fetchMock).toHaveBeenCalledWith('/api/cards/autocomplete?q=light', {
      signal: undefined,
    })
  })

  it('URL-encodes the query', async () => {
    const fetchMock = mockFetch({ names: [] })
    await autocompleteNames('Yawgmoth&Co')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/cards/autocomplete?q=Yawgmoth%26Co',
      { signal: undefined },
    )
  })
})

describe('searchPrintings', () => {
  it('filters results to the exact (case-insensitive) name', async () => {
    mockFetch({
      results: [
        printing({ scryfall_id: 'a', name: 'Lightning Bolt', set_code: 'lea' }),
        printing({ scryfall_id: 'b', name: 'Lightning Bolt', set_code: 'm10' }),
        printing({ scryfall_id: 'c', name: 'Lightning Bolt Token' }),
      ],
      total: 3,
      limit: 100,
      offset: 0,
    })
    const { printings, truncated } = await searchPrintings('lightning bolt')
    expect(printings.map((p) => p.scryfall_id)).toEqual(['a', 'b'])
    expect(truncated).toBe(false)
  })

  it('reports truncation when more matches existed than were scanned', async () => {
    mockFetch({
      results: [printing({ scryfall_id: 'a', name: 'Forest' })],
      total: 250,
      limit: 100,
      offset: 0,
    })
    const { truncated } = await searchPrintings('Forest')
    expect(truncated).toBe(true)
  })

  it('requests a high limit so all printings are considered', async () => {
    const fetchMock = mockFetch({
      results: [],
      total: 0,
      limit: 100,
      offset: 0,
    })
    await searchPrintings('Sol Ring')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/cards/search?q=Sol%20Ring&limit=100',
      { signal: undefined },
    )
  })
})

describe('inscribe', () => {
  it('POSTs the body as JSON and returns the created lot', async () => {
    const lot = { id: 1, scryfall_id: 'a', quantity: 2 }
    const fetchMock = mockFetch(lot)
    const result = await inscribe({
      scryfall_id: 'a',
      quantity: 2,
      finish: 'foil',
      condition: 'NM',
    })
    expect(result).toEqual(lot)
    expect(fetchMock).toHaveBeenCalledWith('/api/inventory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scryfall_id: 'a',
        quantity: 2,
        finish: 'foil',
        condition: 'NM',
      }),
    })
  })
})

describe('parseDecklist', () => {
  it('POSTs the raw text and returns entries + problems', async () => {
    const body = { entries: [{ name: 'Sol Ring' }], problems: [] }
    const fetchMock = mockFetch(body)
    const result = await parseDecklist('1 Sol Ring')
    expect(result).toEqual(body)
    expect(fetchMock).toHaveBeenCalledWith('/api/onboarding/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '1 Sol Ring' }),
    })
  })
})

describe('resolveDecklist', () => {
  it('POSTs entries and returns results + summary', async () => {
    const body = {
      results: [],
      summary: { matched: 0, ambiguous: 0, unmatched: 0 },
    }
    const fetchMock = mockFetch(body)
    const entries = [{ name: 'Sol Ring', quantity: 2 }]
    const result = await resolveDecklist(entries)
    expect(result).toEqual(body)
    expect(fetchMock).toHaveBeenCalledWith('/api/onboarding/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries }),
    })
  })
})

describe('inscribeBulk', () => {
  it('POSTs the rows wrapped in { rows } and returns created + count', async () => {
    const body = { created: [{ id: 1 }], count: 1 }
    const fetchMock = mockFetch(body)
    const rows = [
      {
        scryfall_id: 'a',
        quantity: 4,
        finish: 'nonfoil' as const,
        condition: 'NM' as const,
      },
    ]
    const result = await inscribeBulk(rows)
    expect(result).toEqual(body)
    expect(fetchMock).toHaveBeenCalledWith('/api/inventory/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows }),
    })
  })

  it('surfaces the structured 422 detail.message, not the raw JSON blob', async () => {
    mockFetch(
      {
        detail: {
          message: 'nothing was imported. Re-run the preview and try again.',
          unknown: [{ index: 0 }],
        },
      },
      false,
      422,
    )
    await expect(
      inscribeBulk([
        { scryfall_id: 'x', quantity: 1, finish: 'nonfoil', condition: 'NM' },
      ]),
    ).rejects.toMatchObject({
      status: 422,
      detail: 'nothing was imported. Re-run the preview and try again.',
    })
  })
})

describe('error handling', () => {
  it('throws ApiError with the status on a non-2xx response', async () => {
    mockFetch({ detail: 'nope' }, false, 404)
    await expect(autocompleteNames('x')).rejects.toBeInstanceOf(ApiError)
    mockFetch({ detail: 'nope' }, false, 500)
    await expect(
      inscribe({
        scryfall_id: 'a',
        quantity: 1,
        finish: 'nonfoil',
        condition: 'NM',
      }),
    ).rejects.toMatchObject({ status: 500 })
  })

  it("surfaces the backend's detail on the ApiError", async () => {
    mockFetch({ detail: 'quantity must be > 0' }, false, 422)
    await expect(
      inscribe({
        scryfall_id: 'a',
        quantity: 1,
        finish: 'nonfoil',
        condition: 'NM',
      }),
    ).rejects.toMatchObject({ status: 422, detail: 'quantity must be > 0' })
  })
})
