import { Link, useLocation } from 'react-router-dom'
import type { InventoryLot } from '../api'
import { CardThumb, FinishWord, LedgerEntry } from '../components'
import { conditionWords, printingLine } from './prose'
import { QuantityStepper } from './QuantityStepper'

/** Where a lot page returns to, and what to call it. */
export interface LotBack {
  to: string
  label: string
  /** Link state the target page needs, such as the printing page's indexSearch. */
  state?: unknown
}

/** One owned lot as an entry in a ledger. The stepper is its one control. */
export function LotRow({
  lot,
  number,
  back,
}: {
  lot: InventoryLot
  /** The running number, 1-based across pages. */
  number: number
  back?: LotBack
}) {
  // Hand the folio the page it was opened from, so its back link returns there
  // instead of to page one. A caller outside the Catalog names its own page.
  const { search } = useLocation()
  const backTarget = back ?? {
    to: `/catalog${search}`,
    label: 'Back to the Catalog',
  }
  const finished = lot.finish === 'foil' || lot.finish === 'etched'
  const { reserved, owned } = lot.folio

  return (
    <LedgerEntry
      number={number}
      thumb={<CardThumb images={lot.card.image_uris} name={lot.card.name} />}
      name={
        <>
          <Link to={`/catalog/${lot.id}`} state={{ back: backTarget }}>
            {lot.card.name}
          </Link>
          {finished && (
            <>
              {' '}
              <FinishWord finish={lot.finish} />
            </>
          )}
        </>
      }
      where={`${printingLine(lot.card)}. ${lot.location ?? 'Unshelved'}.`}
      count={<QuantityStepper lot={lot} />}
      note={
        reserved > 0
          ? `${conditionWords(lot.condition)}, ${reserved} of ${owned} in Tomes`
          : conditionWords(lot.condition)
      }
    />
  )
}
