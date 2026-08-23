import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  ApiError,
  CONDITIONS,
  deleteLot,
  getLot,
  updateLot,
  type Condition,
  type InventoryLot,
  type LotPatch,
} from '../api'
import { CardThumb } from './CardThumb'
import { OwnershipSummary } from './OwnershipSummary'
import { readQuantity } from './quantity'
import { inventoryKeys } from './queryKeys'
import './catalog.css'

/** Blank a text field back to null, so "cleared" reaches the API as a clear. */
function orNull(text: string): string | null {
  return text.trim() === '' ? null : text.trim()
}

/**
 * Edit the four fields PATCH accepts. Keyed on the lot id by the caller, so the
 * inputs re-seed from the record whenever a different lot is opened.
 */
function LotEditor({ lot }: { lot: InventoryLot }) {
  const queryClient = useQueryClient()
  const [quantity, setQuantity] = useState(String(lot.quantity))
  const [condition, setCondition] = useState<Condition>(
    lot.condition as Condition,
  )
  const [location, setLocation] = useState(lot.location ?? '')
  const [notes, setNotes] = useState(lot.notes ?? '')

  const save = useMutation({
    mutationFn: (patch: LotPatch) => updateLot(lot.id, patch),
    onSuccess: (updated) => {
      queryClient.setQueryData(inventoryKeys.lot(lot.id), updated)
      queryClient.invalidateQueries({ queryKey: inventoryKeys.all })
    },
  })

  const copies = readQuantity(quantity)

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (copies === null) return
    save.mutate({
      quantity: copies,
      condition,
      location: orNull(location),
      notes: orNull(notes),
    })
  }

  return (
    <form className="lot-editor" onSubmit={handleSubmit}>
      <div className="lot-editor__fields">
        <label>
          Copies
          <input
            type="number"
            min={1}
            required
            aria-invalid={copies === null}
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
        </label>
        <label>
          Condition
          <select
            value={condition}
            onChange={(event) => setCondition(event.target.value as Condition)}
          >
            {CONDITIONS.map((grade) => (
              <option key={grade} value={grade}>
                {grade}
              </option>
            ))}
          </select>
        </label>
        <label>
          Volume
          <input
            type="text"
            value={location}
            placeholder="binder, box, deck sleeve…"
            onChange={(event) => setLocation(event.target.value)}
          />
        </label>
        <label className="lot-editor__notes">
          Notes
          <textarea
            rows={3}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </label>
      </div>

      <div className="lot-editor__actions">
        <button type="submit" disabled={save.isPending}>
          {save.isPending ? 'Amending…' : 'Amend'}
        </button>
        {copies === null && (
          <span className="lot-editor__error" role="alert">
            A folio holds at least one copy. Remove it below to let it go.
          </span>
        )}
        {save.isSuccess && (
          <span className="lot-editor__saved" role="status">
            Amended.
          </span>
        )}
        {save.isError && (
          <span className="lot-editor__error" role="alert">
            {save.error.message}
          </span>
        )}
      </div>
    </form>
  )
}

/** Remove a lot, behind a two-step confirm.
 *
 * Deliberately not `window.confirm`: a native modal blocks the Playwright and
 * browser-automation harness (ADR 0015), and it can't be styled or tested.
 */
function RemoveLot({ lot, backTo }: { lot: InventoryLot; backTo: string }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [confirming, setConfirming] = useState(false)

  const remove = useMutation({
    mutationFn: () => deleteLot(lot.id),
    onSuccess: () => {
      // Drop this lot's cache entry before invalidating the tree. `all` prefix-
      // matches `lot(id)`, and the detail query is still mounted, so invalidating
      // alone would refetch an id that no longer exists and cache the 404.
      queryClient.removeQueries({ queryKey: inventoryKeys.lot(lot.id) })
      queryClient.invalidateQueries({ queryKey: inventoryKeys.all })
      navigate(backTo)
    },
  })

  if (!confirming) {
    return (
      <div className="lot-remove">
        <button
          type="button"
          className="lot-remove__start"
          onClick={() => setConfirming(true)}
        >
          Remove from the collection
        </button>
      </div>
    )
  }

  return (
    <div className="lot-remove lot-remove--confirming">
      <p>
        Remove all {lot.quantity} of this folio? The card stays in the catalog;
        only your record of owning it goes.
      </p>
      <button
        type="button"
        className="lot-remove__confirm"
        disabled={remove.isPending}
        onClick={() => remove.mutate()}
      >
        {remove.isPending ? 'Removing…' : 'Confirm removal'}
      </button>
      <button
        type="button"
        disabled={remove.isPending}
        onClick={() => setConfirming(false)}
      >
        Keep it
      </button>
      {remove.isError && (
        <span className="lot-remove__error" role="alert">
          {remove.error.message}
        </span>
      )}
    </div>
  )
}

/** One inventory lot in full: the folio, what it costs to change, and what
 *  else of this card the collection holds. */
export function LotDetailPage() {
  const { lotId } = useParams()
  const id = Number(lotId)
  const valid = Number.isInteger(id) && id > 0

  // The Catalog hands its page along in link state (see LotRow); a folio opened
  // by URL has none, and falls back to the first page.
  const { state } = useLocation()
  const catalogSearch = (state as { catalogSearch?: string } | null)
    ?.catalogSearch
  const backTo = `/catalog${catalogSearch ?? ''}`

  const query = useQuery({
    queryKey: inventoryKeys.lot(id),
    queryFn: () => getLot(id),
    enabled: valid,
    retry: false,
  })

  if (!valid) {
    return <NotFound />
  }
  if (query.isPending) {
    return (
      <section className="lot-detail">
        <p className="lot-detail__pending">Retrieving the folio…</p>
      </section>
    )
  }
  if (query.isError) {
    if (query.error instanceof ApiError && query.error.status === 404) {
      return <NotFound />
    }
    return (
      <section className="lot-detail">
        <p className="lot-detail__error" role="alert">
          The folio could not be read. {query.error.message}
        </p>
      </section>
    )
  }

  const lot = query.data

  return (
    <section className="lot-detail">
      <p className="lot-detail__back">
        <Link to={backTo}>← Back to the Catalog</Link>
      </p>

      <header className="lot-detail__head">
        <CardThumb
          images={lot.card.image_uris}
          name={lot.card.name}
          size="full"
        />
        <div>
          <h1>{lot.card.name}</h1>
          <p className="lot-detail__folio">
            {lot.card.set_name} · {lot.card.set_code.toUpperCase()} #
            {lot.card.collector_number} · {lot.card.rarity}
          </p>
          <dl className="lot-detail__facts">
            <div>
              <dt>Finish</dt>
              <dd>{lot.finish}</dd>
            </div>
            <div>
              <dt>Language</dt>
              <dd>{lot.language}</dd>
            </div>
            <div>
              <dt>Acquired</dt>
              <dd>{lot.acquired_at ?? '—'}</dd>
            </div>
            <div>
              <dt>Paid</dt>
              <dd>{lot.price_paid ?? '—'}</dd>
            </div>
          </dl>
        </div>
      </header>

      <LotEditor key={lot.id} lot={lot} />
      <OwnershipSummary scryfallId={lot.scryfall_id} />
      <RemoveLot lot={lot} backTo={backTo} />
    </section>
  )
}

function NotFound() {
  return (
    <section className="lot-detail">
      <h1>No such folio</h1>
      <p>
        That inventory record is not in the catalog. It may already have been
        removed. <Link to="/catalog">Back to the Catalog</Link>.
      </p>
    </section>
  )
}
