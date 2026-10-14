import { Link, useLocation } from 'react-router-dom'
import type { SearchFolio } from '../api'
import { CardThumb, Tag, describePrinting } from '../components'
import { printingPath, reservedLine } from './folio'

/** The Volumes a folio's lots sit in, or a muted "unshelved". */
export function Volumes({
  folio,
  className,
}: {
  folio: SearchFolio
  className: string
}) {
  return folio.locations.length > 0 ? (
    <>{folio.locations.join(', ')}</>
  ) : (
    <span className={className}>unshelved</span>
  )
}

/** One folio in the Index grid: the art, what it is, and how many are kept. */
export function FolioTile({ folio }: { folio: SearchFolio }) {
  // The printing page's back link returns to this exact filtered view.
  const { search } = useLocation()
  const { card } = folio

  return (
    <li className="folio-tile">
      <CardThumb images={card.image_uris} name={card.name} size="full" />
      <div className="folio-tile__body">
        <Link
          to={printingPath(folio)}
          state={{ indexSearch: search }}
          className="folio-tile__name"
        >
          {card.name}
        </Link>
        <span className="folio-tile__printing">{describePrinting(card)}</span>
        <span className="folio-tile__meta">
          <Tag>{folio.finish}</Tag>
          <span className="folio-tile__copies" aria-hidden="true">
            ×{folio.quantity}
          </span>
          <span className="visually-hidden">
            {folio.quantity === 1 ? '1 copy' : `${folio.quantity} copies`}
          </span>
        </span>
        {folio.reserved > 0 && (
          <span className="folio-tile__reserved">{reservedLine(folio)}</span>
        )}
        <span className="folio-tile__volumes">
          <Volumes folio={folio} className="folio-tile__unset" />
        </span>
      </div>
    </li>
  )
}
