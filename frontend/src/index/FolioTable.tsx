import { Link, useLocation } from 'react-router-dom'
import type { SearchFolio } from '../api'
import { CardThumb, describePrinting } from '../components'
import { printingPath, reservedLine } from './folio'
import { Volumes } from './FolioTile'

/** The Index as a table, for reading many folios at once. */
export function FolioTable({ folios }: { folios: SearchFolio[] }) {
  const { search } = useLocation()

  return (
    // When the table overflows, a keyboard can only scroll this wrapper if it
    // takes focus, and anything focusable needs a name to announce.
    <div
      className="index__scroll"
      tabIndex={0}
      role="region"
      aria-label="Index table"
    >
      <table className="index__table">
        <caption className="visually-hidden">
          Owned folios matching the filters
        </caption>
        <thead>
          <tr>
            <th scope="col">
              <span className="visually-hidden">Art</span>
            </th>
            <th scope="col">Card</th>
            <th scope="col">Finish</th>
            <th scope="col">Copies</th>
            <th scope="col">Conditions</th>
            <th scope="col">Volumes</th>
            <th scope="col">Tags</th>
          </tr>
        </thead>
        <tbody>
          {folios.map((folio) => (
            <tr
              key={`${folio.scryfall_id}|${folio.finish}`}
              className="index__row"
            >
              <td className="index__art">
                <CardThumb
                  images={folio.card.image_uris}
                  name={folio.card.name}
                />
              </td>
              <td className="index__card">
                <Link
                  to={printingPath(folio)}
                  state={{ indexSearch: search }}
                  className="index__name"
                >
                  {folio.card.name}
                </Link>
                <span className="index__printing">
                  {describePrinting(folio.card)}
                </span>
              </td>
              <td>{folio.finish}</td>
              <td className="index__quantity">
                {folio.quantity}
                {folio.reserved > 0 && (
                  <span className="index__reserved">{reservedLine(folio)}</span>
                )}
              </td>
              <td>{folio.conditions.join(', ')}</td>
              <td>
                <Volumes folio={folio} className="folio-tile__unset" />
              </td>
              <td>{folio.tags.join(', ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
