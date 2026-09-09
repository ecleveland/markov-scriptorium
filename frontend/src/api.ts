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

/** An inventory lot (one acquisition), enriched with a nested card object. */
export interface InventoryLot {
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
  card: {
    name: string
    set_code: string
    set_name: string
    collector_number: string
    rarity: string
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

async function send(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`/api${path}`, init)
  if (!res.ok) {
    const detail = await errorDetail(res)
    throw new ApiError(
      detail ?? `Request to ${path} failed (${res.status})`,
      res.status,
      detail,
    )
  }
  return res
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  return (await (await send(path, init)).json()) as T
}

/** Like `request`, for endpoints that answer 204 with no body to parse. */
async function requestVoid(path: string, init?: RequestInit): Promise<void> {
  await send(path, init)
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
  // CSV imports (VEG-415): an exact printing pin, or an edition display name.
  scryfall_id?: string | null
  set_name?: string | null
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
    scryfall_id?: string | null
    set_name?: string | null
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
  language?: string
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

// --- Bulk onboarding: CSV import (VEG-415) ---------------------------------

/** Collection-export CSV sources we can parse. */
export const CSV_SOURCES = ['manabox', 'deckbox', 'archidekt'] as const
export type CsvSource = (typeof CSV_SOURCES)[number]

/** One normalized CSV row, shaped to become a resolve entry. */
export interface CsvRow {
  row_number: number
  name: string
  quantity: number
  set_code: string | null
  set_name: string | null
  collector_number: string | null
  scryfall_id: string | null
  finish: string | null
  condition: string | null
  language: string | null
}

/** A CSV data row the parser could not read — surfaced, never dropped. */
export interface CsvProblem {
  row_number: number
  text: string
  reason: string
}

export interface CsvParseResult {
  format: CsvSource
  entries: CsvRow[]
  problems: CsvProblem[]
}

/**
 * Parse a collection CSV into normalized rows + per-row problems. `format`
 * overrides header auto-detection (for a hand-edited or unrecognized export).
 * An unrecognized header with no override throws an ApiError (422).
 */
export async function parseCsv(
  text: string,
  format?: CsvSource,
): Promise<CsvParseResult> {
  return request<CsvParseResult>('/onboarding/parse-csv', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, format }),
  })
}

// --- Browsing and managing the collection (VEG-220) ------------------------

/** Default page size for the Catalog list; the backend caps `limit` at 200. */
export const CATALOG_PAGE_SIZE = 25

export interface InventoryListResponse {
  results: InventoryLot[]
  total: number
  limit: number
  offset: number
}

/** The four fields PATCH /inventory/{id} accepts. Omitted keys stay unchanged. */
export interface LotPatch {
  quantity?: number
  condition?: Condition
  location?: string | null
  notes?: string | null
}

/** One (finish, condition, language) folio group within a single printing. */
export interface FolioRollup {
  finish: string
  condition: string
  language: string
  quantity: number
  lots: number
}

/** One printing's share of a card's total ownership. */
export interface PrintingOwnership {
  scryfall_id: string
  set_code: string
  set_name: string
  collector_number: string
  rarity: string
  quantity: number
  lots: number
}

/**
 * A whole card's ownership, summed over every printing of it. `grouping` says
 * how the backend tied the printings together: by Scryfall's `oracle_id`, or by
 * card name when the catalog row has no oracle_id to group on.
 */
export interface AcrossPrintings {
  grouping: 'oracle_id' | 'name'
  oracle_id: string | null
  name: string
  total_quantity: number
  printing_count: number
  printings: PrintingOwnership[]
}

/** GET /inventory/card/{id}: one printing's lots, its folio rollup, and the
 *  same card's total across every printing. */
export interface OwnedForPrinting {
  scryfall_id: string
  card: InventoryLot['card'] | null
  lots: InventoryLot[]
  rollup: FolioRollup[]
  total_quantity: number
  across_printings: AcrossPrintings | null
}

/** One page of owned lots, newest first. */
export async function listInventory(
  offset = 0,
  limit: number = CATALOG_PAGE_SIZE,
): Promise<InventoryListResponse> {
  return request<InventoryListResponse>(
    `/inventory?limit=${limit}&offset=${offset}`,
  )
}

/** One lot by id. Throws ApiError 404 when it does not exist. */
export async function getLot(lotId: number): Promise<InventoryLot> {
  return request<InventoryLot>(`/inventory/${lotId}`)
}

/** Amend a lot; returns the updated record. */
export async function updateLot(
  lotId: number,
  patch: LotPatch,
): Promise<InventoryLot> {
  return request<InventoryLot>(`/inventory/${lotId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
}

/** Remove a lot from the collection. Answers 204, so there is nothing to read. */
export async function deleteLot(lotId: number): Promise<void> {
  return requestVoid(`/inventory/${lotId}`, { method: 'DELETE' })
}

/** Everything owned of one printing, plus the card-level cross-printing total. */
export async function ownedForPrinting(
  scryfallId: string,
): Promise<OwnedForPrinting> {
  return request<OwnedForPrinting>(
    `/inventory/card/${encodeURIComponent(scryfallId)}`,
  )
}
