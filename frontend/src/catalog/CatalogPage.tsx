import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { CATALOG_PAGE_SIZE, listInventory } from '../api'
import {
  Button,
  Consulting,
  EmptyState,
  Ledger,
  Notice,
  PageHeader,
} from '../components'
import { LotRow } from './LotRow'
import { capitalised, counted } from './prose'
import { inventoryKeys } from './queryKeys'
import './catalog.css'

/** The 1-based page from `?page=`, defaulting to the first on anything odd. */
function pageFromParams(params: URLSearchParams): number {
  const raw = Number(params.get('page'))
  return Number.isInteger(raw) && raw > 0 ? raw : 1
}

/** The page's one heading, over whichever state the catalog is in. */
function Shell({ children }: { children: ReactNode }) {
  return (
    <section className="catalog">
      <PageHeader
        title={
          <>
            The <span className="rubric">Catalog</span>
          </>
        }
      />
      {children}
    </section>
  )
}

/**
 * The Catalog: every owned lot, newest inscription first, one page at a time,
 * set out as a numbered ledger.
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
    // doesn't flash the whole ledger away and back.
    placeholderData: keepPreviousData,
  })

  if (query.isPending) {
    return (
      <Shell>
        <Consulting />
      </Shell>
    )
  }

  if (query.isError) {
    return (
      <Shell>
        <Notice tone="danger" role="alert">
          The catalog could not be read. {query.error.message}
        </Notice>
      </Shell>
    )
  }

  // The offset the entries on screen actually came from. `keepPreviousData`
  // holds the old page during a fetch, so numbering them from the *requested*
  // offset would put 26 against the first entry of page one.
  const { results, total, offset: shownOffset } = query.data

  // The collection can shrink under a bookmarked or returned-to page (remove the
  // only folio on page 2 and page 2 stops existing). Land on the last real page
  // rather than an empty ledger.
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
      <Shell>
        <EmptyState title="Nothing inscribed yet">
          Add a card through <Link to="/inscribe">Inscribe</Link>, or bring a
          whole collection in from a <Link to="/import/decklist">decklist</Link>{' '}
          or a <Link to="/import/csv">CSV export</Link>.
        </EmptyState>
      </Shell>
    )
  }

  const onLastPage = offset + CATALOG_PAGE_SIZE >= total

  return (
    <Shell>
      <p className="catalog__opening">
        {capitalised(counted(total, 'entry', 'entries'))} in the Catalog, the
        newest inscribed first.
      </p>

      <Ledger aria-label="Lots">
        {results.map((lot, i) => (
          <LotRow key={lot.id} lot={lot} number={shownOffset + i + 1} />
        ))}
      </Ledger>

      {total > CATALOG_PAGE_SIZE && (
        <nav className="pager" aria-label="Catalog pages">
          <Button
            variant="ghost"
            disabled={page <= 1}
            onClick={() => goToPage(page - 1)}
          >
            Newer entries
          </Button>
          <Button
            variant="ghost"
            disabled={onLastPage}
            onClick={() => goToPage(page + 1)}
          >
            Older entries
          </Button>
        </nav>
      )}
    </Shell>
  )
}
