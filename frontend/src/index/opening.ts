// The sentence under the Index's heading (VEG-624). It says how much the
// Catalog holds when nothing narrows it, and how much matches when something
// does, in the words a printed catalogue would use.

import { capitalised, counted } from '../catalog/prose'

/** "Forty folios", "One folio", "312 folios". */
function folios(n: number): string {
  return capitalised(counted(n, 'folio', 'folios'))
}

/**
 * The opening for the whole Catalog: "Three folios, kept in two Volumes. No
 * Tomes bound." A count left undefined is still loading or failed to load,
 * and its clause is left out rather than guessed.
 */
export function unfilteredOpening({
  folios: total,
  volumes,
  tomes,
}: {
  folios: number
  volumes?: number
  tomes?: number
}): string {
  let shelf = ''
  if (volumes === 0) shelf = ', none of them shelved in a Volume'
  else if (volumes !== undefined) {
    shelf = `, kept in ${counted(volumes, 'Volume', 'Volumes')}`
  }
  const first = `${folios(total)}${shelf}.`
  if (tomes === undefined) return first
  return `${first} ${capitalised(counted(tomes, 'Tome', 'Tomes'))} bound.`
}

/**
 * The opening for a narrowed Index: "Forty folios match 'bolt'.", "One folio
 * matches these filters.", or "Forty folios match 'bolt' within these
 * filters." when a name and other filters both narrow it.
 */
export function filteredOpening({
  total,
  name,
  otherFilters,
}: {
  total: number
  name: string
  otherFilters: boolean
}): string {
  const verb = total === 1 ? 'matches' : 'match'
  const trimmed = name.trim()
  const quoted = `'${trimmed}'`
  let what: string
  if (trimmed === '') what = 'these filters'
  else if (otherFilters) what = `${quoted} within these filters`
  else what = quoted
  return `${folios(total)} ${verb} ${what}.`
}
