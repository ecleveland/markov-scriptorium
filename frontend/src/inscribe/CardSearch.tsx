import { useEffect, useRef, useState } from 'react'
import { autocompleteNames } from '../api'
import { useDebouncedValue } from '../hooks/useDebouncedValue'

interface Props {
  onSelect: (name: string) => void
  autoFocus?: boolean
}

/**
 * Type-ahead search over the local catalog's distinct card names. Lookups are
 * debounced and the in-flight request is aborted when the query changes, so a
 * fast typist doesn't race stale responses onto the list.
 */
export function CardSearch({ onSelect, autoFocus }: Props) {
  const [query, setQuery] = useState('')
  const [names, setNames] = useState<string[]>([])
  const [failed, setFailed] = useState(false)
  // The query the current names/failed belong to; results are only shown when
  // this matches the live debounced query, so a previous query's suggestions
  // never linger while a newer lookup is pending.
  const [resultsQuery, setResultsQuery] = useState('')
  const debounced = useDebouncedValue(query.trim(), 200)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
  }, [autoFocus])

  useEffect(() => {
    if (!debounced) return
    const controller = new AbortController()
    autocompleteNames(debounced, controller.signal)
      .then((matches) => {
        setNames(matches)
        setResultsQuery(debounced)
        setFailed(false)
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        console.error('Autocomplete failed', err)
        setNames([])
        setResultsQuery(debounced)
        setFailed(true)
      })
    return () => controller.abort()
  }, [debounced])

  function choose(name: string) {
    onSelect(name)
    setQuery('')
    setNames([])
    setResultsQuery('')
  }

  // Only surface results/errors that belong to the query the user currently sees.
  const showResults = debounced.length > 0 && resultsQuery === debounced

  return (
    <div className="card-search">
      <label htmlFor="card-search-input">Card name</label>
      <input
        id="card-search-input"
        ref={inputRef}
        type="text"
        autoComplete="off"
        placeholder="Search the catalog…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {showResults && failed && (
        <p role="alert">The catalog could not be reached.</p>
      )}
      {showResults && names.length > 0 && (
        <ul
          className="card-search__results"
          role="listbox"
          aria-label="Matching cards"
        >
          {names.map((name) => (
            <li key={name} role="option" aria-selected={false}>
              <button type="button" onClick={() => choose(name)}>
                {name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
