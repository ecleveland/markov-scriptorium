import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { listDecks } from '../api'
import { counted } from '../catalog/prose'
import { Consulting, EmptyState, Notice, PageHeader } from '../components'
import { TomeCreateForm } from './TomeCreateForm'
import { tomeKeys } from './queryKeys'
import { STATUS_LABELS, spineEdge } from './status'
import './tomes.css'

/** Every Tome on the shelf, newest first, with the form that binds another. */
export function TomesPage() {
  const query = useQuery({ queryKey: tomeKeys.list(), queryFn: listDecks })

  return (
    <section className="tomes">
      <PageHeader
        title={
          <>
            The <span className="rubric">Tomes</span>
          </>
        }
      />
      <TomeCreateForm />

      {query.isPending && <Consulting>Taking down the Tomes…</Consulting>}
      {query.isError && (
        <Notice tone="danger" role="alert">
          {query.data === undefined
            ? 'The Tomes could not be read.'
            : 'The Tomes could not be refreshed.'}{' '}
          {query.error.message}
        </Notice>
      )}
      {/* A failed refresh keeps the cached list on screen. */}
      {query.data !== undefined && query.data.length === 0 && (
        <EmptyState title="No Tomes bound yet">
          Bind one above, then add its cards from the collection or the catalog.
        </EmptyState>
      )}
      {query.data !== undefined && query.data.length > 0 && (
        <ul className="shelf" aria-label="Tomes">
          {query.data.map((deck) => (
            <li key={deck.id} className="shelf__item">
              {/* The spaces keep the link's accessible name readable; the
                  spine stacks its parts, so they do not show. */}
              <Link
                to={`/tomes/${deck.id}`}
                className="spine"
                data-edge={spineEdge(deck)}
              >
                <b className="spine__name">{deck.name}</b>{' '}
                <span className="spine__meta">
                  {deck.format ?? 'no format'},{' '}
                  {counted(deck.card_count, 'card', 'cards')}
                </span>{' '}
                <span className="spine__status">
                  {STATUS_LABELS[deck.status]}
                  {!deck.claims_cards && ', references only'}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
