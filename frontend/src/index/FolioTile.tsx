import { Link, useLocation } from 'react-router-dom'
import type { SearchFolio } from '../api'
import { printingLine, shelfPhrase } from '../catalog/prose'
import { CardThumb, FinishWord } from '../components'
import { hasFinishWord, printingPath, reservedLine } from './folio'

/** One folio in the Index grid: the art, what it is, and how many are kept. */
export function FolioTile({ folio }: { folio: SearchFolio }) {
  // The printing page's back link returns to this exact filtered view.
  const { search } = useLocation()
  const { card } = folio

  return (
    <li className="folio-tile">
      <CardThumb images={card.image_uris} name={card.name} size="full" />
      <div className="folio-tile__body">
        {/* The finish sits outside the link, so the link is named by the card
            alone. The link's ::after still covers the whole tile. */}
        <span className="folio-tile__title">
          <Link
            to={printingPath(folio)}
            state={{ indexSearch: search }}
            className="folio-tile__name"
          >
            {card.name}
          </Link>
          {hasFinishWord(folio.finish) && (
            <>
              {' '}
              <FinishWord finish={folio.finish} />
            </>
          )}
        </span>
        <span className="folio-tile__printing">
          {printingLine(card)}. {shelfPhrase(folio.locations)}.
        </span>
        <span className="folio-tile__copies" aria-hidden="true">
          ×{folio.quantity}
        </span>
        <span className="visually-hidden">
          {folio.quantity === 1 ? '1 copy' : `${folio.quantity} copies`}
        </span>
        {folio.reserved > 0 && (
          <span className="folio-tile__reserved">{reservedLine(folio)}</span>
        )}
      </div>
    </li>
  )
}
