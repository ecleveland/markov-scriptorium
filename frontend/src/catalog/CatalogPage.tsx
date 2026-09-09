import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { CATALOG_PAGE_SIZE, listInventory } from '../api'
import { LotRow } from './LotRow'
import { inventoryKeys } from './queryKeys'
import './catalog.css'

/** "Showing 1 to 25 of 87 folios" — 1-based and inclusive, as people read it. */
function pageRange(offset: number, shown: number): string {
  return shown === 0 ? '0' : `${offset + 1} to ${offset + shown}`
}

/** The 1-based page from `?page=`, defaulting to the first on anything odd. */
function pageFromParams(params: URLSearchParams): number {
  const raw = Number(params.get('page'))
  return Number.isInteger(raw) && raw > 0 ? raw : 1
}

/**
 * The Catalog: every owned lot, newest inscription first, one page at a time.
 *
 * Deliberately unfiltered. Search and faceted browse are The Index (M5); this
 * view exists so the collection can be read back at all.
 *
 * The page lives in the URL rather than component state, so opening a folio and
 * coming back does not silently drop you on page one.
 */
export function CatalogPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const page = pageFromParams(searchParams)
  const offset = (page - 1) * CATALOG_PAGE_SIZE

  function goToPage(next: number) {
    // Page one is the bare URL; no `?page=1` clutter.
    setSearchParams(next <= 1 ? {} : { page: String(next) })
  }

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

  // The offset the rows on screen actually came from. `keepPreviousData` holds
  // the old page during a fetch, so pairing the *requested* offset with them
  // would read "Showing 26 to 50 of 30" above rows 1 to 25.
  const { results, total, offset: shownOffset } = query.data

  // The collection can shrink under a bookmarked or returned-to page (remove the
  // only folio on page 2 and page 2 stops existing). Land on the last real page
  // rather than an empty table with headers.
  if (total > 0 && offset >= total) {
    const lastPage = Math.ceil(total / CATALOG_PAGE_SIZE)
    return (
      <Navigate
        to={lastPage <= 1 ? '/catalog' : `/catalog?page=${lastPage}`}
        replace
      />
    )
  }

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

  const onLastPage = offset + CATALOG_PAGE_SIZE >= total

  return (
    <section className="catalog">
      <h1>The Catalog</h1>
      <p className="catalog__count">
        Showing {pageRange(shownOffset, results.length)} of {total}{' '}
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
          disabled={page <= 1}
          onClick={() => goToPage(page - 1)}
        >
          Previous
        </button>
        <button
          type="button"
          disabled={onLastPage}
          onClick={() => goToPage(page + 1)}
        >
          Next
        </button>
      </nav>
    </section>
  )
}
