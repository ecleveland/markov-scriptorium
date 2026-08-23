import { Link, useLocation } from 'react-router-dom'
import type { InventoryLot } from '../api'
import { CardThumb } from './CardThumb'
import { QuantityStepper } from './QuantityStepper'

/** One owned lot as a row of the Catalog table. */
export function LotRow({ lot }: { lot: InventoryLot }) {
  // Hand the folio the page it was opened from, so its back link returns there
  // instead of to page one.
  const { search } = useLocation()

  return (
    <tr className="catalog__row">
      <td className="catalog__art">
        <CardThumb images={lot.card.image_uris} name={lot.card.name} />
      </td>
      <td className="catalog__card">
        <Link
          to={`/catalog/${lot.id}`}
          state={{ catalogSearch: search }}
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
      </td>
    </tr>
  )
}
