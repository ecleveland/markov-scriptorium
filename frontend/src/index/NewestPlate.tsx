import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { listInventory } from '../api'
import {
  capitalised,
  conditionWords,
  counted,
  printingLine,
  tomeClaim,
} from '../catalog/prose'
import { inventoryKeys } from '../catalog/queryKeys'
import { CardThumb, FinishWord, Plate } from '../components'
import { hasFinishWord } from './folio'

/**
 * The newest inscription on a lit plate, at the top of the unfiltered Index.
 * It reads the Catalog's own newest-first list rather than the Index search,
 * because under any sort but newest first the search's first row is not the
 * newest lot. While that list loads, fails or is empty, the plate is left out.
 */
export function NewestPlate() {
  const query = useQuery({
    queryKey: inventoryKeys.newest(),
    queryFn: () => listInventory(0, 1),
  })
  const lot = query.data?.results[0]
  if (lot === undefined) return null

  const { card } = lot
  const copies = capitalised(counted(lot.quantity, 'copy', 'copies'))
  const shelf = lot.location ? `in ${lot.location}` : 'unshelved'

  return (
    <Plate
      label="Newest inscription"
      className="index__plate"
      art={<CardThumb images={card.image_uris} name={card.name} size="full" />}
      heading={
        <h2>
          {card.name}
          {hasFinishWord(lot.finish) && (
            <>
              {' '}
              <FinishWord finish={lot.finish} />
            </>
          )}
        </h2>
      }
      lines={
        <>
          <p className="plate__printing">
            {printingLine(card)}, {card.rarity}.
          </p>
          <p>
            {copies}, {conditionWords(lot.condition)}, {shelf}.{' '}
            {tomeClaim(lot.folio)}
          </p>
        </>
      }
      actions={
        <>
          {/* Shelving happens on the lot's own form, which returns here. */}
          <Link
            to={`/catalog/${lot.id}`}
            state={{ back: { to: '/index', label: 'Back to the Index' } }}
            className="btn btn--primary"
          >
            {lot.location
              ? 'Move it to another Volume'
              : 'Shelve it in a Volume'}
          </Link>
          <Link
            to={`/index/${encodeURIComponent(lot.scryfall_id)}`}
            state={{ indexSearch: '' }}
            className="btn btn--ghost"
          >
            Open the folio
          </Link>
        </>
      }
    />
  )
}
