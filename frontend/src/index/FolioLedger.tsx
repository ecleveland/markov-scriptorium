import { Link, useLocation } from 'react-router-dom'
import type { SearchFolio } from '../api'
import { conditionWords, printingLine, shelfPhrase } from '../catalog/prose'
import {
  CardThumb,
  FinishWord,
  Ledger,
  LedgerEntry,
  LedgerFigure,
} from '../components'
import { hasFinishWord, printingPath } from './folio'

/** "near mint, lightly played", then how many copies Tomes hold and how many
 *  are left free, if any Tome holds one. */
function folioNote(folio: SearchFolio): string {
  const conditions = folio.conditions.map(conditionWords).join(', ')
  return folio.reserved > 0
    ? `${conditions}, ${folio.reserved} in Tomes, ${folio.available} free`
    : conditions
}

/**
 * The Index as a ledger, for reading many folios at once. `offset` is where
 * the shown rows start in the whole result, so page two carries the numbering
 * on from page one.
 */
export function FolioLedger({
  folios,
  offset,
}: {
  folios: SearchFolio[]
  offset: number
}) {
  // The printing page's back link returns to this exact filtered view.
  const { search } = useLocation()

  return (
    <Ledger aria-label="Folios">
      {folios.map((folio, i) => (
        <LedgerEntry
          key={`${folio.scryfall_id}|${folio.finish}`}
          number={offset + i + 1}
          thumb={
            <CardThumb images={folio.card.image_uris} name={folio.card.name} />
          }
          name={
            <>
              <Link to={printingPath(folio)} state={{ indexSearch: search }}>
                {folio.card.name}
              </Link>
              {hasFinishWord(folio.finish) && (
                <>
                  {' '}
                  <FinishWord finish={folio.finish} />
                </>
              )}
            </>
          }
          where={`${printingLine(folio.card)}. ${shelfPhrase(folio.locations)}.`}
          count={
            <>
              <LedgerFigure>{folio.quantity}</LedgerFigure>
              <span className="visually-hidden">
                {folio.quantity === 1 ? ' copy' : ' copies'}
              </span>
            </>
          }
          note={folioNote(folio)}
        />
      ))}
    </Ledger>
  )
}
