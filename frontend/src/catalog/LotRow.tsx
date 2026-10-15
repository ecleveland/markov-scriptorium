import { Link, useLocation } from 'react-router-dom'
import type { InventoryLot } from '../api'
import { CardThumb } from '../components'
import { QuantityStepper } from './QuantityStepper'

/** Where a lot page returns to, and what to call it. */
export interface LotBack {
  to: string
  label: string
  /** Link state the target page needs, such as the printing page's indexSearch. */
  state?: unknown
}

/** One owned lot as a row of the Catalog table. */
export function LotRow({ lot, back }: { lot: InventoryLot; back?: LotBack }) {
  // Hand the folio the page it was opened from, so its back link returns there
  // instead of to page one. A caller outside the Catalog names its own page.
  const { search } = useLocation()
  const backTarget = back ?? {
    to: `/catalog${search}`,
    label: 'Back to the Catalog',
  }

  return (
    <tr className="catalog__row">
      <td className="catalog__art">
        <CardThumb images={lot.card.image_uris} name={lot.card.name} />
      </td>
      <td className="catalog__card">
        <Link
          to={`/catalog/${lot.id}`}
          state={{ back: backTarget }}
          className="catalog__name"
        >
          {lot.card.name}
        </Link>
        <span className="catalog__folio">
          {lot.card.set_name} · {lot.card.set_code.toUpperCase()} #
          {lot.card.collector_number}
        </span>
      </td>
      <td>{lot.finish}</td>
      <td>{lot.condition}</td>
      <td>
        {lot.location ?? <span className="catalog__unset">unshelved</span>}
      </td>
      <td className="catalog__quantity">
        <QuantityStepper lot={lot} />
        {lot.folio.reserved > 0 && (
          <span className="catalog__reserved">
            {lot.folio.reserved} of {lot.folio.owned} in Tomes ·{' '}
            {lot.folio.available} free
          </span>
        )}
      </td>
    </tr>
  )
}
