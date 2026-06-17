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
        setFailed(false)
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true)
      })
    return () => controller.abort()
  }, [debounced])

  // Results/errors belong to the current query; when the box is empty we simply
  // don't show the (possibly stale) last results, avoiding a reset in the effect.
  const showResults = query.trim().length > 0

  function choose(name: string) {
    onSelect(name)
    setQuery('')
    setNames([])
  }

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
            <li key={name}>
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
