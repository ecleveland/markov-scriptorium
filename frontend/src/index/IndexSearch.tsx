import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { searchFolios, type SearchParams } from '../api'
import { inventoryKeys } from '../catalog/queryKeys'
import { Field, Input } from '../components'
import { useArrowKeyList } from '../hooks/useArrowKeyList'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { readIndexParams, refine, writeIndexParams } from './indexParams'

const DEBOUNCE_MS = 250
const MIN_SUGGEST_LENGTH = 2
const MAX_SUGGESTIONS = 8

/**
 * The Index's name search. Typing writes `?name=` once the typist pauses, and
 * replaces the history entry rather than pushing one, so Back leaves the Index
 * instead of stepping through every prefix typed.
 *
 * Suggestions come from the search endpoint itself, so they name only cards
 * the collection holds, unlike Inscribe's type-ahead over the whole catalog.
 */
export function IndexSearch() {
  const [searchParams, setSearchParams] = useSearchParams()
  const urlName = searchParams.get('name') ?? ''

  const [text, setText] = useState(urlName)
  const [open, setOpen] = useState(true)
  // When the URL's name changes from outside (Clear filters, Back), the input
  // follows it. A change this component wrote already matches the text.
  const [seenUrlName, setSeenUrlName] = useState(urlName)
  if (urlName !== seenUrlName) {
    setSeenUrlName(urlName)
    if (urlName !== text.trim()) setText(urlName)
  }

  const debounced = useDebouncedValue(text.trim(), DEBOUNCE_MS)
  // Write only when the debounced text itself moves. Reacting to the URL as
  // well would put a name back that Clear filters just took out.
  const lastSent = useRef(debounced)
  useEffect(() => {
    if (debounced === lastSent.current) return
    lastSent.current = debounced
    if (debounced === urlName) return
    setSearchParams(
      writeIndexParams(
        refine(readIndexParams(searchParams), { name: debounced }),
      ),
      { replace: true },
    )
  }, [debounced, urlName, searchParams, setSearchParams])

  const suggestParams: SearchParams = {
    name: debounced,
    limit: 20,
    sort: 'name',
  }
  const suggestions = useQuery({
    queryKey: inventoryKeys.search(suggestParams),
    queryFn: ({ signal }) => searchFolios(suggestParams, signal),
    enabled: debounced.length >= MIN_SUGGEST_LENGTH,
  })
  const arrowKeys = useArrowKeyList()

  // Several folios share a name (two finishes, two printings); suggest it once.
  const names = [
    ...new Set(suggestions.data?.results.map((row) => row.card.name) ?? []),
  ].slice(0, MAX_SUGGESTIONS)
  const typed = text.trim()
  const onlyEchoesInput =
    names.length === 1 && names[0].toLowerCase() === typed.toLowerCase()
  const showSuggestions =
    open &&
    typed === debounced &&
    typed.length >= MIN_SUGGEST_LENGTH &&
    names.length > 0 &&
    !onlyEchoesInput

  function pick(name: string) {
    setText(name)
    setOpen(false)
    setSearchParams(
      writeIndexParams(refine(readIndexParams(searchParams), { name })),
      { replace: true },
    )
  }

  return (
    <div className="index__search" role="search">
      <Field label="Search the Index">
        <Input
          type="search"
          autoComplete="off"
          placeholder="A card name, or part of one…"
          value={text}
          onChange={(event) => {
            setText(event.target.value)
            setOpen(true)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setOpen(false)
          }}
        />
      </Field>
      {showSuggestions && (
        <ul
          className="listbox index__suggestions"
          aria-label="Owned cards"
          {...arrowKeys}
        >
          {names.map((name) => (
            <li key={name}>
              <button
                type="button"
                className="listbox__option"
                onClick={() => pick(name)}
              >
                {name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
