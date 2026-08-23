import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CATALOG_PAGE_SIZE, listInventory } from '../api'
import { LotRow } from './LotRow'
import { inventoryKeys } from './queryKeys'
import './catalog.css'

/** "Showing 1 to 25 of 87 folios" — 1-based and inclusive, as people read it. */
function pageRange(offset: number, shown: number): string {
  return shown === 0 ? '0' : `${offset + 1} to ${offset + shown}`
}

/**
 * The Catalog: every owned lot, newest inscription first, one page at a time.
 *
 * Deliberately unfiltered. Search and faceted browse are The Index (M5); this
 * view exists so the collection can be read back at all.
 */
export function CatalogPage() {
  const [offset, setOffset] = useState(0)
  const query = useQuery({
    queryKey: inventoryKeys.list(offset),
    queryFn: () => listInventory(offset),
    // Keep the previous page on screen while the next one loads, so paging
    // doesn't flash the whole table away and back.
    placeholderData: keepPreviousData,
  })

  if (query.isPending) {
    return (
      <section className="catalog">
        <h1>The Catalog</h1>
        <p className="catalog__pending">Consulting the catalog…</p>
      </section>
    )
  }

  if (query.isError) {
    return (
      <section className="catalog">
        <h1>The Catalog</h1>
        <p className="catalog__error" role="alert">
          The catalog could not be read. {query.error.message}
        </p>
      </section>
    )
  }

  const { results, total } = query.data

  if (total === 0) {
    return (
      <section className="catalog">
        <h1>The Catalog</h1>
        <p className="catalog__empty">
          Nothing inscribed yet. Add a card through{' '}
          <Link to="/inscribe">Inscribe</Link>, or bring a whole collection in
          from a <Link to="/import/decklist">decklist</Link> or a{' '}
          <Link to="/import/csv">CSV export</Link>.
        </p>
      </section>
    )
  }

  const lastPage = offset + CATALOG_PAGE_SIZE >= total

  return (
    <section className="catalog">
      <h1>The Catalog</h1>
      <p className="catalog__count">
        Showing {pageRange(offset, results.length)} of {total}{' '}
        {total === 1 ? 'folio' : 'folios'}
      </p>

      <table className="catalog__table">
        <caption className="visually-hidden">
          Owned cards, newest inscription first
        </caption>
        <thead>
          <tr>
            <th scope="col">
              <span className="visually-hidden">Art</span>
            </th>
            <th scope="col">Card</th>
            <th scope="col">Finish</th>
            <th scope="col">Condition</th>
            <th scope="col">Volume</th>
            <th scope="col">Copies</th>
          </tr>
        </thead>
        <tbody>
          {results.map((lot) => (
            <LotRow key={lot.id} lot={lot} />
          ))}
        </tbody>
      </table>

      <nav className="catalog__pager" aria-label="Catalog pages">
        <button
          type="button"
          disabled={offset === 0}
          onClick={() => setOffset(Math.max(0, offset - CATALOG_PAGE_SIZE))}
        >
          Previous
        </button>
        <button
          type="button"
          disabled={lastPage}
          onClick={() => setOffset(offset + CATALOG_PAGE_SIZE)}
        >
          Next
        </button>
      </nav>
    </section>
  )
}
