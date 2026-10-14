// Query keys for everything read out of the local inventory. All of them nest
// under `inventoryKeys.all`, so one invalidation after a write refreshes the
// list, the open lot, any ownership summary on screen, and The Index's search
// and facets.

import type { SearchParams } from '../api'

export const inventoryKeys = {
  all: ['inventory'] as const,
  list: (offset: number) => ['inventory', 'list', offset] as const,
  lot: (lotId: number) => ['inventory', 'lot', lotId] as const,
  ownership: (scryfallId: string) =>
    ['inventory', 'ownership', scryfallId] as const,
  search: (params: SearchParams) => ['inventory', 'search', params] as const,
  facets: () => ['inventory', 'facets'] as const,
}
