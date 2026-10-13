import { useQuery } from '@tanstack/react-query'
import { Link, useLocation, useParams } from 'react-router-dom'
import { ApiError, ownedForPrinting } from '../api'
import { LotRow } from '../catalog/LotRow'
import { OwnershipSummary } from '../catalog/OwnershipSummary'
import { inventoryKeys } from '../catalog/queryKeys'
import { CardThumb, Consulting, Notice } from '../components'
import '../catalog/catalog.css'
import './index.css'

/**
 * One printing as the Index opens it: the card plate, copies per finish, every
 * lot of it as a Catalog row, and how much of the card the collection holds
 * across printings. Each row links on to the lot itself in the Catalog.
 */
export function PrintingPage() {
  const { scryfallId = '' } = useParams()

  // The Index hands its URL along in link state (see FolioTile); a printing
  // opened by URL has none and returns to the bare Index.
  const { state } = useLocation()
  const indexSearch = (state as { indexSearch?: string } | null)?.indexSearch
  const backTo = `/index${indexSearch ?? ''}`

  // The same key OwnershipSummary reads, so the summary below costs no second
  // request.
  const query = useQuery({
    queryKey: inventoryKeys.ownership(scryfallId),
    queryFn: () => ownedForPrinting(scryfallId),
    retry: false,
  })

  if (query.isPending) {
    return (
      <section className="lot-detail">
        <Consulting>Retrieving the printing…</Consulting>
      </section>
    )
  }
  if (query.isError) {
    if (query.error instanceof ApiError && query.error.status === 404) {
      return <NoSuchPrinting />
    }
    return (
      <section className="lot-detail">
        <Notice tone="danger" role="alert">
          The printing could not be read. {query.error.message}
        </Notice>
      </section>
    )
  }

  const { card, lots, reservations } = query.data
  if (card === null) return <NoSuchPrinting />

  return (
    <section className="lot-detail">
      <p className="lot-detail__back">
        <Link to={backTo}>← Back to the Index</Link>
      </p>

      <header className="lot-detail__head">
        <CardThumb images={card.image_uris} name={card.name} size="full" />
        <div>
          <h1>{card.name}</h1>
          <p className="lot-detail__folio">
            {card.set_name} · {card.set_code.toUpperCase()} #
            {card.collector_number} · {card.rarity}
          </p>
          {reservations.length > 0 && (
            <dl className="lot-detail__facts">
              {reservations.map((entry) => (
                <div key={entry.finish}>
                  <dt>{entry.finish}</dt>
                  <dd>
                    {entry.owned} owned · {entry.reserved} in Tomes ·{' '}
                    {entry.available} free
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </header>

      {lots.length === 0 ? (
        <Notice className="printing-page__none">
          None of this printing is in the collection.
        </Notice>
      ) : (
        <div
          className="catalog__scroll"
          tabIndex={0}
          role="region"
          aria-label="Lots of this printing"
        >
          <table className="catalog__table">
            <caption className="visually-hidden">
              Every lot of this printing
            </caption>
            <thead>
              <tr>
                <th scope="col">
                  <span className="visually-hidden">Art</span>
                </th>
                <th scope="col">Card</th>
                <th scope="col">Finish</th>
                <th scope="col">Condition</th>
                <th scope="col">Volume</th>
                <th scope="col">Copies</th>
              </tr>
            </thead>
            <tbody>
              {lots.map((lot) => (
                <LotRow key={lot.id} lot={lot} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <OwnershipSummary scryfallId={scryfallId} />
    </section>
  )
}

function NoSuchPrinting() {
  return (
    <section className="lot-detail">
      <h1>No such printing</h1>
      <p>
        The catalog holds no printing by that id.{' '}
        <Link to="/index">Back to the Index</Link>.
      </p>
    </section>
  )
}
