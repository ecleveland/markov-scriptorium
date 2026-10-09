import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ApiError, deleteDeck, getDeck, type Deck, type DeckSlot } from '../api'
import {
  Button,
  Consulting,
  EmptyState,
  Field,
  Notice,
  Select,
} from '../components'
import { AddCard } from './AddCard'
import { BOARD_LABELS, groupByBoard, type BoardGroup } from './boards'
import { SlotRow } from './SlotRow'
import { TomeAmendForm } from './TomeAmendForm'
import { TomeHead } from './TomeHead'
import { invalidateAfterSlotWrite } from './invalidate'
import { NoSuchTome } from './NoSuchTome'
import { tomeKeys } from './queryKeys'
import { sortSlots, type SlotSort } from './sort'
import { readDeckId } from './status'
import './tomes.css'

/** One Tome open for editing: its settings, a way to add cards, and its cards. */
export function TomeEditorPage() {
  const deckId = readDeckId(useParams().deckId)

  const query = useQuery({
    queryKey: tomeKeys.tome(deckId ?? 0),
    queryFn: () => getDeck(deckId!),
    enabled: deckId !== null,
    retry: false,
  })

  if (deckId === null) return <NoSuchTome />
  // Only a failed first read replaces the page. A failed background refetch
  // keeps the cached Tome on screen, so unsaved amend edits survive it.
  if (query.data === undefined) {
    if (query.isError) {
      if (query.error instanceof ApiError && query.error.status === 404) {
        return <NoSuchTome />
      }
      return (
        <section className="tome">
          <Notice tone="danger" role="alert">
            The Tome could not be read. {query.error.message}
          </Notice>
        </section>
      )
    }
    return (
      <section className="tome">
        <Consulting>Opening the Tome…</Consulting>
      </section>
    )
  }

  const deck = query.data

  return (
    <section className="tome">
      <p className="tome__back">
        <Link to="/tomes">← Back to the Tomes</Link>
      </p>
      {query.isError && (
        <Notice tone="danger" role="alert">
          The Tome could not be refreshed. {query.error.message}
        </Notice>
      )}
      <TomeHead key={`head-${deck.id}`} deck={deck} />
      <TomeAmendForm key={`amend-${deck.id}`} deck={deck} />
      <AddCard deckId={deck.id} />
      <SlotList slots={deck.cards} />
      <UnbindTome deck={deck} />
    </section>
  )
}

function readSort(params: URLSearchParams): SlotSort {
  return params.get('sort') === 'cmc' ? 'cmc' : 'type'
}

/** The Tome's cards, grouped by board, each board sorted as the URL says. */
function SlotList({ slots }: { slots: DeckSlot[] }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const sort = readSort(searchParams)

  if (slots.length === 0) {
    return (
      <EmptyState title="No cards bound yet">
        Search for a card above to add it to this Tome.
      </EmptyState>
    )
  }

  return (
    <div className="tome-cards">
      <div className="tome-cards__toolbar">
        <Field label="Sort by">
          <Select
            value={sort}
            onChange={(event) =>
              // Type is the default, so it is the bare URL.
              setSearchParams(
                event.target.value === 'cmc' ? { sort: 'cmc' } : {},
              )
            }
          >
            <option value="type">Card type</option>
            <option value="cmc">Mana value</option>
          </Select>
        </Field>
      </div>
      {groupByBoard(slots).map((group) => (
        <BoardSection key={group.board} group={group} sort={sort} />
      ))}
    </div>
  )
}

function BoardSection({
  group,
  sort,
}: {
  group: BoardGroup<DeckSlot>
  sort: SlotSort
}) {
  const headingId = useId()
  return (
    <section className="tome-board" aria-labelledby={headingId}>
      <h3 id={headingId}>
        {BOARD_LABELS[group.board]} · {group.copies}
      </h3>
      <ul className="tome-board__slots">
        {sortSlots(group.rows, sort).map((slot) => (
          <SlotRow key={slot.id} slot={slot} />
        ))}
      </ul>
    </section>
  )
}

/** Unbind the Tome, behind the same two-step inline confirm the Catalog uses. */
function UnbindTome({ deck }: { deck: Deck }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [confirming, setConfirming] = useState(false)

  const unbind = useMutation({
    mutationFn: () => deleteDeck(deck.id),
    onSuccess: () => {
      // Leave first, so no editor is mounted to rebuild a query for the gone
      // id. Then drop its entries, since `all` prefix-matches them and
      // invalidating alone would refetch an id that no longer exists.
      navigate('/tomes')
      queryClient.removeQueries({ queryKey: tomeKeys.tome(deck.id) })
      queryClient.removeQueries({ queryKey: tomeKeys.breakdown(deck.id) })
      return invalidateAfterSlotWrite(queryClient)
    },
  })

  if (!confirming) {
    return (
      <div className="tome-unbind">
        <Button variant="danger" onClick={() => setConfirming(true)}>
          Unbind this Tome
        </Button>
      </div>
    )
  }

  return (
    <div className="tome-unbind tome-unbind--confirming">
      <p>
        Unbind {deck.name}? Its card list goes with it; the cards stay in the
        collection.
      </p>
      <Button
        variant="primary"
        disabled={unbind.isPending}
        onClick={() => unbind.mutate()}
      >
        {unbind.isPending ? 'Unbinding…' : 'Confirm unbinding'}
      </Button>
      <Button disabled={unbind.isPending} onClick={() => setConfirming(false)}>
        Keep it
      </Button>
      {unbind.isError && (
        <Notice as="span" tone="danger" role="alert">
          {unbind.error.message}
        </Notice>
      )}
    </div>
  )
}
