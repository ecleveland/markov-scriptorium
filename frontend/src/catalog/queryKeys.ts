// Query keys for everything read out of the local inventory. All of them nest
// under `inventoryKeys.all`, so one invalidation after a write refreshes the
// list, the open lot, and any ownership summary on screen.

export const inventoryKeys = {
  all: ['inventory'] as const,
  list: (offset: number) => ['inventory', 'list', offset] as const,
  lot: (lotId: number) => ['inventory', 'lot', lotId] as const,
  ownership: (scryfallId: string) =>
    ['inventory', 'ownership', scryfallId] as const,
}
