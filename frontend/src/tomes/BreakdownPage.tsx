import { useQuery } from '@tanstack/react-query'
import { useId } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ApiError, getBreakdown, getDeck, type BreakdownLine } from '../api'
import { numberWords, printingLine } from '../catalog/prose'
import {
  CardThumb,
  Consulting,
  FinishWord,
  Ledger,
  LedgerEntry,
  LedgerFigure,
  Notice,
  PageHeader,
} from '../components'
import { BoardHead } from './BoardHead'
import {
  BOARD_LABELS,
  boardOffsets,
  groupByBoard,
  type BoardGroup,
} from './boards'
import { NoSuchTome } from './NoSuchTome'
import { tomeKeys } from './queryKeys'
import { readDeckId, tallySentence } from './status'
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
  // A 404 replaces the page even over cached data, as on the editor.
  if (failure instanceof ApiError && failure.status === 404) {
    return <NoSuchTome />
  }
  if (tome.data === undefined || breakdown.data === undefined) {
    if (failure) {
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
  const groups = groupByBoard(lines)
  const offsets = boardOffsets(groups)

  return (
    <section className="tome">
      <p className="tome__back">
        <Link to={`/tomes/${deckId}`}>Back to the Tome</Link>
      </p>
      {failure && (
        <Notice tone="danger" role="alert">
          The breakdown could not be refreshed. {failure.message}
        </Notice>
      )}
      <PageHeader title={tome.data.name} />
      <p className="tome__tally">{tallySentence(totals)}</p>
      {groups.map((group, i) => (
        <BreakdownGroup key={group.board} group={group} offset={offsets[i]} />
      ))}
    </section>
  )
}

function BreakdownGroup({
  group,
  offset,
}: {
  group: BoardGroup<BreakdownLine>
  /** Lines on the boards above, so the numbering carries on. */
  offset: number
}) {
  const headingId = useId()
  return (
    <section className="tome-board" aria-labelledby={headingId}>
      <BoardHead id={headingId} group={group} />
      <Ledger aria-label={`${BOARD_LABELS[group.board]} tally`}>
        {group.rows.map((line, i) => (
          <BreakdownRow key={line.id} line={line} number={offset + i + 1} />
        ))}
      </Ledger>
    </section>
  )
}

/** "two in Double Masters 2022, no. 117 and one in Modern Horizons 2, no. 3" */
function freePrintings(
  free: readonly {
    available: number
    set_name: string
    collector_number: string
  }[],
): string {
  const parts = free.map(
    (p) => `${numberWords(p.available)} in ${printingLine(p)}`,
  )
  if (parts.length === 1) return parts[0]
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

function BreakdownRow({
  line,
  number,
}: {
  line: BreakdownLine
  number: number
}) {
  // Only another printing with a free copy helps. The line's own printing is
  // already counted in `have`, and one held by other Tomes is no use.
  const free =
    line.needed > 0
      ? (line.swap_hint?.printings.filter(
          (p) => p.scryfall_id !== line.scryfall_id && p.available > 0,
        ) ?? [])
      : []
  const freeCopies = free.reduce((sum, p) => sum + p.available, 0)
  const finished = line.finish === 'foil' || line.finish === 'etched'

  return (
    <LedgerEntry
      number={number}
      thumb={<CardThumb images={line.card.image_uris} name={line.card.name} />}
      name={
        <>
          {line.quantity}× {line.card.name}
          {finished && (
            <>
              {' '}
              <FinishWord finish={line.finish} />
            </>
          )}
        </>
      }
      where={`${printingLine(line.card)}.`}
      count={<LedgerFigure>{line.have}</LedgerFigure>}
      // The figure is what is in hand, so the note names it once and then
      // what is still needed: "3, in hand, 2 needed".
      note={line.needed === 0 ? 'in hand' : `in hand, ${line.needed} needed`}
      aside={
        free.length > 0 && (
          <p className="tome-slot__hint" role="note">
            You own {numberWords(freeCopies)} free in other printings:{' '}
            {freePrintings(free)}.
          </p>
        )
      }
    />
  )
}
