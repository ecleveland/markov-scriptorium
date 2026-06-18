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
  /** The backend's `detail` (FastAPI error body), when present. */
  readonly detail?: string

  constructor(message: string, status: number, detail?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }
}

/** Pull FastAPI's `{ detail }` off an error response, tolerant of any body. */
async function errorDetail(res: Response): Promise<string | undefined> {
  try {
    const body = (await res.json()) as { detail?: unknown }
    if (typeof body.detail === 'string') return body.detail
    // Structured details (e.g. the bulk-inscribe 422 `{message, unknown}`) carry
    // a human sentence in `message` — surface that, not the raw JSON blob.
    if (body.detail != null && typeof body.detail === 'object') {
      const message = (body.detail as { message?: unknown }).message
      if (typeof message === 'string') return message
    }
    if (body.detail != null) return JSON.stringify(body.detail)
  } catch {
    // Non-JSON body; the status code alone will have to do.
  }
  return undefined
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, init)
  if (!res.ok) {
    const detail = await errorDetail(res)
    throw new ApiError(
      detail ?? `Request to ${path} failed (${res.status})`,
      res.status,
      detail,
    )
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

/** Max search rows we fetch before filtering to exact-name printings. */
export const PRINTINGS_SCAN_LIMIT = 100

export interface PrintingsResult {
  printings: CardPrinting[]
  /**
   * True when the catalog held more search matches than we scanned, so some
   * exact-name printings may be missing (fuzzy matches aren't exact-ranked).
   * The UI surfaces this rather than silently showing a partial list.
   */
  truncated: boolean
}

/**
 * Printings of a card by exact name. The catalog's search is substring/fuzzy,
 * so we over-fetch and filter to the exact (case-insensitive) name — that is
 * the set of printings the user can actually inscribe for the chosen card.
 */
export async function searchPrintings(
  name: string,
  signal?: AbortSignal,
): Promise<PrintingsResult> {
  if (!name.trim()) return { printings: [], truncated: false }
  const body = await request<SearchResponse>(
    `/cards/search?q=${encodeURIComponent(name)}&limit=${PRINTINGS_SCAN_LIMIT}`,
    { signal },
  )
  const target = name.trim().toLowerCase()
  const printings = body.results.filter((p) => p.name.toLowerCase() === target)
  return { printings, truncated: body.total > body.results.length }
}

/** Inscribe a card into the collection. */
export async function inscribe(body: InscribeRequest): Promise<InventoryLot> {
  return request<InventoryLot>('/inventory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// --- Bulk onboarding: decklist paste (VEG-414) -----------------------------

/** Max rows the backend accepts in one resolve/bulk batch (mirrors the API). */
export const MAX_BULK_ROWS = 10000

/** One parsed decklist line, ready to become a resolve entry. */
export interface ParsedLine {
  line_number: number
  name: string
  quantity: number
  set_code: string | null
  collector_number: string | null
}

/** A decklist line the parser could not read — surfaced, never dropped. */
export interface ParseProblem {
  line_number: number
  text: string
  reason: string
}

export interface ParseResult {
  entries: ParsedLine[]
  problems: ParseProblem[]
}

/** Parse pasted decklist text into entries + per-line problems (no catalog). */
export async function parseDecklist(text: string): Promise<ParseResult> {
  return request<ParseResult>('/onboarding/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
}

/** One entry to resolve against the catalog. Mirrors the backend RawEntry. */
export interface ResolveEntry {
  name: string
  set_code?: string | null
  collector_number?: string | null
  quantity?: number
}

export type ResolutionStatus = 'matched' | 'ambiguous' | 'unmatched'

/** How one entry resolved: a single match, several candidates, or nothing. */
export interface ResolveResult {
  // Echoed back verbatim — the backend serializes the whole RawEntry, so the
  // acquisition fields are present even though the decklist flow doesn't set them.
  input: ResolveEntry & {
    quantity: number
    finish: string | null
    condition: string | null
    language: string | null
  }
  status: ResolutionStatus
  match: CardPrinting | null
  candidates: CardPrinting[]
}

export interface ResolveResponse {
  results: ResolveResult[]
  summary: Record<ResolutionStatus, number>
}

/** Resolve parsed entries to catalog printings; writes nothing. */
export async function resolveDecklist(
  entries: ResolveEntry[],
): Promise<ResolveResponse> {
  return request<ResolveResponse>('/onboarding/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entries }),
  })
}

/** One resolved row to inscribe in the atomic bulk batch. */
export interface BulkInscribeRow {
  scryfall_id: string
  quantity: number
  finish: Finish
  condition: Condition
  location?: string | null
}

export interface BulkInscribeResponse {
  created: InventoryLot[]
  count: number
}

/** Inscribe many resolved rows in one all-or-nothing batch. */
export async function inscribeBulk(
  rows: BulkInscribeRow[],
): Promise<BulkInscribeResponse> {
  return request<BulkInscribeResponse>('/inventory/bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows }),
  })
}
