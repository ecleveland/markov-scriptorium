// The Index keeps every filter, the sort, the view and the page in the URL, so
// a folio round trip keeps your place and a filtered view is a link you can
// keep. Params carry the API's own names (ADR 0021), plus `view` and `page`.
// Defaults are left out, so the bare `/index` is the unfiltered first page.

import {
  COLORS,
  CONDITIONS,
  FINISHES,
  INDEX_PAGE_SIZE,
  SORT_KEYS,
  type Color,
  type Condition,
  type Finish,
  type SearchParams,
  type SortKey,
  type SortOrder,
} from '../api'

export type IndexView = 'grid' | 'list'

/**
 * Which color question the checked colors ask. `colors` matches a card printed
 * in any of them; `identity` keeps cards whose identity fits within them.
 */
export type ColorMode = 'colors' | 'identity'

export interface IndexState {
  name: string
  sets: string[]
  colors: Color[]
  colorMode: ColorMode
  type: string
  tags: string[]
  locations: string[]
  finishes: Finish[]
  conditions: Condition[]
  sort: SortKey
  order: SortOrder
  view: IndexView
  /** 1-based. */
  page: number
}

/** Everything a change to which drops the reader back to page one. */
export type IndexRefinement = Partial<Omit<IndexState, 'view' | 'page'>>

export const EMPTY_INDEX: IndexState = {
  name: '',
  sets: [],
  colors: [],
  colorMode: 'colors',
  type: '',
  tags: [],
  locations: [],
  finishes: [],
  conditions: [],
  sort: 'added',
  order: 'desc',
  view: 'grid',
  page: 1,
}

/** The order the backend picks when none is sent: biggest and newest first,
 *  names and sets from the start of the alphabet. */
export function defaultOrder(sort: SortKey): SortOrder {
  return sort === 'added' || sort === 'quantity' ? 'desc' : 'asc'
}

function oneOf<T extends string>(
  allowed: readonly T[],
  value: string | null,
): T | undefined {
  return allowed.find((candidate) => candidate === value)
}

/** Every non-blank value of a repeated param, in order, without repeats. */
function listParam(params: URLSearchParams, key: string): string[] {
  return [...new Set(params.getAll(key).filter((value) => value !== ''))]
}

/** A repeated param kept to the values the API accepts for it. */
function enumParam<T extends string>(
  params: URLSearchParams,
  key: string,
  allowed: readonly T[],
): T[] {
  return listParam(params, key).flatMap((value) => {
    const known = oneOf(allowed, value)
    return known === undefined ? [] : [known]
  })
}

/** The Index state a URL describes. Unknown values are dropped, not sent. */
export function readIndexParams(params: URLSearchParams): IndexState {
  const identity = enumParam(params, 'color_identity', COLORS)
  const sort = oneOf(SORT_KEYS, params.get('sort')) ?? 'added'
  const page = Number(params.get('page'))
  return {
    name: params.get('name') ?? '',
    sets: listParam(params, 'set'),
    colors:
      identity.length > 0 ? identity : enumParam(params, 'colors', COLORS),
    colorMode: identity.length > 0 ? 'identity' : 'colors',
    type: params.get('type') ?? '',
    tags: listParam(params, 'tag'),
    locations: listParam(params, 'location'),
    finishes: enumParam(params, 'finish', FINISHES),
    conditions: enumParam(params, 'condition', CONDITIONS),
    sort,
    order:
      oneOf(['asc', 'desc'] as const, params.get('order')) ??
      defaultOrder(sort),
    view: params.get('view') === 'list' ? 'list' : 'grid',
    page: Number.isInteger(page) && page > 0 ? page : 1,
  }
}

/** The URL for an Index state, leaving every default out. */
export function writeIndexParams(state: IndexState): URLSearchParams {
  const params = new URLSearchParams()
  const add = (key: string, values: readonly string[]) => {
    for (const value of values) params.append(key, value)
  }
  if (state.name !== '') params.set('name', state.name)
  add('set', state.sets)
  add(
    state.colorMode === 'identity' ? 'color_identity' : 'colors',
    state.colors,
  )
  if (state.type !== '') params.set('type', state.type)
  add('tag', state.tags)
  add('location', state.locations)
  add('finish', state.finishes)
  add('condition', state.conditions)
  if (state.sort !== 'added') params.set('sort', state.sort)
  if (state.order !== defaultOrder(state.sort)) params.set('order', state.order)
  if (state.view !== 'grid') params.set('view', state.view)
  if (state.page > 1) params.set('page', String(state.page))
  return params
}

/**
 * Apply a change to the filters, search text, sort or order. The page goes
 * back to one, because page four of a different result is somewhere else. A
 * new sort key brings its own default order unless the change names one.
 */
export function refine(state: IndexState, change: IndexRefinement): IndexState {
  const order =
    change.order ??
    (change.sort === undefined ? state.order : defaultOrder(change.sort))
  return { ...state, ...change, order, page: 1 }
}

/** True when anything narrows the result. Sort, view and page do not. */
export function isFiltered(state: IndexState): boolean {
  return (
    state.name.trim() !== '' ||
    state.type !== '' ||
    [
      state.sets,
      state.colors,
      state.tags,
      state.locations,
      state.finishes,
      state.conditions,
    ].some((list) => list.length > 0)
  )
}

/** The search request for one page of the Index. Empty filters are left out. */
export function toSearchParams(state: IndexState): SearchParams {
  const params: SearchParams = {}
  const name = state.name.trim()
  if (name !== '') params.name = name
  if (state.sets.length > 0) params.set = state.sets
  if (state.colors.length > 0) {
    if (state.colorMode === 'identity') params.color_identity = state.colors
    else params.colors = state.colors
  }
  if (state.type !== '') params.type = state.type
  if (state.tags.length > 0) params.tag = state.tags
  if (state.locations.length > 0) params.location = state.locations
  if (state.finishes.length > 0) params.finish = state.finishes
  if (state.conditions.length > 0) params.condition = state.conditions
  params.sort = state.sort
  params.order = state.order
  params.limit = INDEX_PAGE_SIZE
  params.offset = (state.page - 1) * INDEX_PAGE_SIZE
  return params
}
