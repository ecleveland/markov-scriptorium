import {
  keepPreviousData,
  useQuery,
  type UseQueryResult,
} from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import {
  INDEX_PAGE_SIZE,
  SORT_KEYS,
  searchFolios,
  type SearchFoliosResponse,
  type SortKey,
  type SortOrder,
} from '../api'
import { inventoryKeys } from '../catalog/queryKeys'
import {
  Button,
  Consulting,
  EmptyState,
  Field,
  Notice,
  PageHeader,
  Select,
} from '../components'
import { FacetSidebar } from './FacetSidebar'
import { FolioTable } from './FolioTable'
import { FolioTile } from './FolioTile'
import { IndexSearch } from './IndexSearch'
import {
  EMPTY_INDEX,
  isFiltered,
  readIndexParams,
  refine,
  toSearchParams,
  writeIndexParams,
  type IndexRefinement,
  type IndexState,
  type IndexView,
} from './indexParams'
import './index.css'

const SORT_LABELS: Record<SortKey, string> = {
  added: 'Date added',
  name: 'Name',
  set: 'Set',
  quantity: 'Copies',
}

/** What the order button says for each key, as [ascending, descending]. */
const ORDER_LABELS: Record<SortKey, Record<SortOrder, string>> = {
  added: { asc: 'Oldest first', desc: 'Newest first' },
  name: { asc: 'A to Z', desc: 'Z to A' },
  set: { asc: 'A to Z', desc: 'Z to A' },
  quantity: { asc: 'Fewest copies', desc: 'Most copies' },
}

/** "Showing 1 to 24 of 87 folios", 1-based and inclusive, as people read it. */
function pageRange(offset: number, shown: number): string {
  return shown === 0 ? '0' : `${offset + 1} to ${offset + shown}`
}

/** `/index` with the state's query string, or bare when it has none. */
function indexPath(state: IndexState): string {
  const query = writeIndexParams(state).toString()
  return query === '' ? '/index' : `/index?${query}`
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <section className="index">
      <PageHeader eyebrow="The Catalog, searched" title="The Index" />
      {children}
    </section>
  )
}

/**
 * The Index: the owned collection one folio per tile, searched by name,
 * narrowed by facets, sorted and paged.
 *
 * Everything that picks what is on screen lives in the URL (see indexParams),
 * so opening a folio and coming back lands on the same filtered page.
 */
export function IndexPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const state = readIndexParams(searchParams)
  const params = toSearchParams(state)

  function show(next: IndexState) {
    setSearchParams(writeIndexParams(next))
  }
  const narrow = (change: IndexRefinement) => show(refine(state, change))
  const view = (next: IndexView) => show({ ...state, view: next })
  const goToPage = (next: number) => show({ ...state, page: next })
  // Clearing drops what narrows the result, not how it is laid out.
  const clear = () =>
    navigate(
      indexPath({
        ...EMPTY_INDEX,
        view: state.view,
        sort: state.sort,
        order: state.order,
      }),
    )

  const query = useQuery({
    queryKey: inventoryKeys.search(params),
    queryFn: ({ signal }) => searchFolios(params, signal),
    // Keep the previous page on screen while the next one loads, so paging
    // and filtering do not flash the grid away and back.
    placeholderData: keepPreviousData,
  })

  const filtered = isFiltered(state)

  // While a new key loads, `data` is the previous key's answer. Its total says
  // nothing about this URL, so neither the redirect nor the empty collection
  // may act on it. Results still shows those rows as the placeholder.
  if (query.isSuccess && !query.isPlaceholderData) {
    const { total } = query.data
    const offset = params.offset ?? 0
    // The collection can shrink under a bookmarked or returned-to page. Land
    // on the last real page rather than an empty grid.
    if (total > 0 && offset >= total) {
      const lastPage = Math.ceil(total / INDEX_PAGE_SIZE)
      return <Navigate to={indexPath({ ...state, page: lastPage })} replace />
    }
    if (total === 0 && !filtered) {
      return (
        <Shell>
          <EmptyState title="Nothing inscribed yet">
            Add a card through <Link to="/inscribe">Inscribe</Link>, or bring a
            whole collection in from a{' '}
            <Link to="/import/decklist">decklist</Link> or a{' '}
            <Link to="/import/csv">CSV export</Link>.
          </EmptyState>
        </Shell>
      )
    }
  }

  return (
    <Shell>
      <IndexSearch />
      <div className="index__layout">
        <FacetSidebar state={state} onRefine={narrow} />
        <div className="index__results">
          <div className="index__toolbar">
            <Field label="Sort by" className="index__sort">
              <Select
                value={state.sort}
                onChange={(event) =>
                  narrow({ sort: event.target.value as SortKey })
                }
              >
                {SORT_KEYS.map((key) => (
                  <option key={key} value={key}>
                    {SORT_LABELS[key]}
                  </option>
                ))}
              </Select>
            </Field>
            <Button
              onClick={() =>
                narrow({ order: state.order === 'asc' ? 'desc' : 'asc' })
              }
            >
              {ORDER_LABELS[state.sort][state.order]}
            </Button>
            <div className="index__views" role="group" aria-label="View">
              <Button
                variant="ghost"
                aria-pressed={state.view === 'grid'}
                onClick={() => view('grid')}
              >
                Grid
              </Button>
              <Button
                variant="ghost"
                aria-pressed={state.view === 'list'}
                onClick={() => view('list')}
              >
                List
              </Button>
            </div>
          </div>
          <Results
            query={query}
            state={state}
            onClear={clear}
            onPage={goToPage}
          />
        </div>
      </div>
    </Shell>
  )
}

function Results({
  query,
  state,
  onClear,
  onPage,
}: {
  query: UseQueryResult<SearchFoliosResponse>
  state: IndexState
  onClear: () => void
  onPage: (page: number) => void
}) {
  if (query.isPending) return <Consulting />
  if (query.isError) {
    return (
      <Notice tone="danger" role="alert">
        The Index could not be read. {query.error.message}
      </Notice>
    )
  }

  // The offset the rows on screen came from. `keepPreviousData` holds the old
  // page during a fetch, so the requested offset would misdescribe them.
  const { results, total, offset: shownOffset } = query.data
  // A placeholder's total belongs to the previous request. It may not say
  // nothing matches, and the pager may not page by it.
  const stale = query.isPlaceholderData

  if (total === 0) {
    if (stale) return <Consulting />
    return (
      <div className="index__none">
        <Notice role="status">
          Nothing in the Index matches these filters.
        </Notice>
        <Button onClick={onClear}>Clear filters</Button>
      </div>
    )
  }

  const onLastPage = state.page * INDEX_PAGE_SIZE >= total

  return (
    <>
      <Notice>
        Showing {pageRange(shownOffset, results.length)} of {total}{' '}
        {total === 1 ? 'folio' : 'folios'}
      </Notice>
      {state.view === 'list' ? (
        <FolioTable folios={results} />
      ) : (
        <ul className="index__grid" aria-label="Folios">
          {results.map((folio) => (
            <FolioTile
              key={`${folio.scryfall_id}|${folio.finish}`}
              folio={folio}
            />
          ))}
        </ul>
      )}
      <nav className="index__pager" aria-label="Index pages">
        <Button
          disabled={stale || state.page <= 1}
          onClick={() => onPage(state.page - 1)}
        >
          Previous
        </Button>
        <Button
          disabled={stale || onLastPage}
          onClick={() => onPage(state.page + 1)}
        >
          Next
        </Button>
      </nav>
    </>
  )
}
