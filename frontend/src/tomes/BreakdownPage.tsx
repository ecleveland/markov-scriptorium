import { useQuery } from '@tanstack/react-query'
import { useId } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ApiError, getBreakdown, getDeck, type BreakdownLine } from '../api'
import { CardThumb } from '../catalog/CardThumb'
import {
  Consulting,
  Notice,
  PageHeader,
  Tag,
  describePrinting,
} from '../components'
import { BOARD_LABELS, groupByBoard, type BoardGroup } from './boards'
import { NoSuchTome } from './NoSuchTome'
import { tomeKeys } from './queryKeys'
import { cardCount, readDeckId } from './status'
import './tomes.css'
import '../catalog/catalog.css'

/** Owned versus needed for every slot of a Tome, maybeboard excluded. */
export function BreakdownPage() {
  const deckId = readDeckId(useParams().deckId)

  const tome = useQuery({
    queryKey: tomeKeys.tome(deckId ?? 0),
    queryFn: () => getDeck(deckId!),
    enabled: deckId !== null,
    retry: false,
  })
  const breakdown = useQuery({
    queryKey: tomeKeys.breakdown(deckId ?? 0),
    queryFn: () => getBreakdown(deckId!),
    enabled: deckId !== null,
    retry: false,
  })

  if (deckId === null) return <NoSuchTome />
  // Only a failed first read replaces the page; a failed refresh keeps what
  // is cached on screen with a notice above it.
  const failure = tome.error ?? breakdown.error
  if (tome.data === undefined || breakdown.data === undefined) {
    if (failure) {
      if (failure instanceof ApiError && failure.status === 404) {
        return <NoSuchTome />
      }
      return (
        <section className="tome">
          <Notice tone="danger" role="alert">
            The breakdown could not be read. {failure.message}
          </Notice>
        </section>
      )
    }
    return (
      <section className="tome">
        <Consulting>Counting what is in hand…</Consulting>
      </section>
    )
  }

  const { lines, totals } = breakdown.data

  return (
    <section className="tome">
      <p className="tome__back">
        <Link to={`/tomes/${deckId}`}>← Back to the Tome</Link>
      </p>
      {failure && (
        <Notice tone="danger" role="alert">
          The breakdown could not be refreshed. {failure.message}
        </Notice>
      )}
      <PageHeader eyebrow="Owned and needed" title={tome.data.name} />
      <Notice>
        {cardCount(totals.cards)}, {totals.have} in hand, {totals.needed} needed
      </Notice>
      {groupByBoard(lines).map((group) => (
        <BreakdownGroup key={group.board} group={group} />
      ))}
    </section>
  )
}

function BreakdownGroup({ group }: { group: BoardGroup<BreakdownLine> }) {
  const headingId = useId()
  return (
    <section className="tome-board" aria-labelledby={headingId}>
      <h3 id={headingId}>
        {BOARD_LABELS[group.board]} · {group.copies}
      </h3>
      <ul className="tome-board__slots">
        {group.rows.map((line) => (
          <BreakdownRow key={line.id} line={line} />
        ))}
      </ul>
    </section>
  )
}

function BreakdownRow({ line }: { line: BreakdownLine }) {
  // Only another printing with a free copy helps. The line's own printing is
  // already counted in `have`, and one held by other Tomes is no use.
  const free =
    line.needed > 0
      ? (line.swap_hint?.printings.filter(
          (p) => p.scryfall_id !== line.scryfall_id && p.available > 0,
        ) ?? [])
      : []
  const freeCopies = free.reduce((sum, p) => sum + p.available, 0)

  return (
    <li className="tome-slot">
      <CardThumb images={line.card.image_uris} name={line.card.name} />
      <div className="tome-slot__card">
        <span className="tome-slot__name">
          {line.quantity}× {line.card.name}
        </span>
        <span className="tome-slot__folio">
          {describePrinting(line.card)} · {line.finish}
        </span>
        {free.length > 0 && (
          <div className="tome-slot__hint" role="note">
            You own {freeCopies} free in other printings:
            <ul>
              {free.map((p) => (
                <li key={p.scryfall_id}>
                  {p.available} free · {describePrinting(p)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <div className="tome-slot__actions">
        {line.needed === 0 ? (
          <Tag tone="success">in hand</Tag>
        ) : (
          <Tag tone="warning">{line.needed} needed</Tag>
        )}
      </div>
    </li>
  )
}
