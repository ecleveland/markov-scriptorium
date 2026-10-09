import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  DECK_STATUSES,
  updateDeck,
  type Deck,
  type DeckPatch,
  type DeckStatus,
  type DeckWithCards,
} from '../api'
import { inventoryKeys } from '../catalog/queryKeys'
import { Field, Notice, PageHeader, Select } from '../components'
import { tomeKeys } from './queryKeys'
import { STATUS_LABELS } from './status'

/**
 * The Tome's title, plus the two settings that save the moment they change:
 * status and whether the Tome claims its cards. Keyed on the Tome id by the
 * caller, so the controls re-seed when another Tome opens.
 */
export function TomeHead({ deck }: { deck: Deck }) {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<DeckStatus>(deck.status)
  const [claims, setClaims] = useState(deck.claims_cards)

  const save = useMutation({
    mutationFn: (patch: DeckPatch) => updateDeck(deck.id, patch),
    // Returned, so the controls stay disabled until the Tome is read back.
    onSuccess: (_deck, patch) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: tomeKeys.all }),
        // Claiming or releasing cards moves the Catalog's reserved counts.
        patch.claims_cards !== undefined &&
          queryClient.invalidateQueries({ queryKey: inventoryKeys.all }),
      ]),
    // A refused change must not leave the control showing what was refused.
    // Reset from the cache, which holds the last save; the prop can lag it.
    onError: () => {
      const latest =
        queryClient.getQueryData<DeckWithCards>(tomeKeys.tome(deck.id)) ?? deck
      setStatus(latest.status)
      setClaims(latest.claims_cards)
    },
  })

  return (
    <>
      <PageHeader eyebrow={deck.format ?? 'Tome'} title={deck.name}>
        <Link to={`/tomes/${deck.id}/breakdown`} className="tome-head__link">
          Owned and needed
        </Link>
      </PageHeader>

      <div className="tome-head__controls">
        <Field label="Status">
          <Select
            value={status}
            disabled={save.isPending}
            onChange={(event) => {
              const next = event.target.value as DeckStatus
              setStatus(next)
              save.mutate({ status: next })
            }}
          >
            {DECK_STATUSES.map((option) => (
              <option key={option} value={option}>
                {STATUS_LABELS[option]}
              </option>
            ))}
          </Select>
        </Field>
        <label className="tome-check">
          <input
            type="checkbox"
            checked={claims}
            disabled={save.isPending}
            onChange={(event) => {
              setClaims(event.target.checked)
              save.mutate({ claims_cards: event.target.checked })
            }}
          />
          This Tome claims its cards
        </label>
        {save.isSuccess && (
          <Notice as="span" tone="success" role="status">
            Saved.
          </Notice>
        )}
        {save.isError && (
          <Notice as="span" tone="danger" role="alert">
            {save.error.message}
          </Notice>
        )}
      </div>
    </>
  )
}
