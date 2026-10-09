import type { QueryClient } from '@tanstack/react-query'
import { inventoryKeys } from '../catalog/queryKeys'
import { tomeKeys } from './queryKeys'

/**
 * Refresh every Tome read and every inventory read after a slot write. A
 * claiming Tome's slots move the Catalog's reserved counts, so both trees go.
 *
 * Return this from a mutation's `onSuccess`, so the mutation stays pending
 * until the refetch lands. Otherwise a control re-enables over stale data and
 * a quick second click sends the same quantity again.
 */
export function invalidateAfterSlotWrite(
  queryClient: QueryClient,
): Promise<unknown> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: tomeKeys.all }),
    queryClient.invalidateQueries({ queryKey: inventoryKeys.all }),
  ])
}
