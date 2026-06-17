// Typed client for the Scriptorium backend. All calls go through the `/api`
// prefix, which Vite proxies to the FastAPI backend in dev (see vite.config.ts).
// Reads come from the local card catalog (never live Scryfall); writes inscribe
// into the local inventory.

export const FINISHES = ['nonfoil', 'foil', 'etched'] as const
export type Finish = (typeof FINISHES)[number]

export const CONDITIONS = ['NM', 'LP', 'MP', 'HP', 'DMG'] as const
export type Condition = (typeof CONDITIONS)[number]

/** A single printing as served by the card catalog endpoints. */
export interface CardPrinting {
  scryfall_id: string
  name: string
  set_code: string
  set_name: string
  collector_number: string
  rarity: string
  finishes: string[] | null
  image_uris: Record<string, string> | null
}

export interface SearchResponse {
  results: CardPrinting[]
  total: number
  limit: number
  offset: number
}

/** Body for inscribing a card into the collection (POST /inventory). */
export interface InscribeRequest {
  scryfall_id: string
  quantity: number
  finish: Finish
  condition: Condition
  location?: string | null
}

/** The created inventory lot, enriched with a nested card display object. */
export interface InventoryLot {
  id: number
  scryfall_id: string
  quantity: number
  finish: string
  condition: string
  location: string | null
  card: {
    name: string
    set_code: string
    set_name: string
    collector_number: string
    image_uris: Record<string, string> | null
  }
}

/** Raised on a non-2xx response so callers can surface a message. */
export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, init)
  if (!res.ok) {
    throw new ApiError(`Request to ${path} failed (${res.status})`, res.status)
  }
  return (await res.json()) as T
}

/** Distinct card names matching `query`, for type-ahead. Blank query → []. */
export async function autocompleteNames(
  query: string,
  signal?: AbortSignal,
): Promise<string[]> {
  if (!query.trim()) return []
  const body = await request<{ names: string[] }>(
    `/cards/autocomplete?q=${encodeURIComponent(query)}`,
    { signal },
  )
  return body.names
}

/**
 * Printings of a card by exact name. The catalog's search is substring/fuzzy,
 * so we over-fetch and filter to the exact (case-insensitive) name — that is
 * the set of printings the user can actually inscribe for the chosen card.
 */
export async function searchPrintings(
  name: string,
  signal?: AbortSignal,
): Promise<CardPrinting[]> {
  if (!name.trim()) return []
  const body = await request<SearchResponse>(
    `/cards/search?q=${encodeURIComponent(name)}&limit=100`,
    { signal },
  )
  const target = name.trim().toLowerCase()
  return body.results.filter((p) => p.name.toLowerCase() === target)
}

/** Inscribe a card into the collection. */
export async function inscribe(body: InscribeRequest): Promise<InventoryLot> {
  return request<InventoryLot>('/inventory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}
