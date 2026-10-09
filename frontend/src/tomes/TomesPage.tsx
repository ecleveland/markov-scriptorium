import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { listDecks } from '../api'
import { Consulting, EmptyState, Notice, PageHeader, Tag } from '../components'
import { TomeCreateForm } from './TomeCreateForm'
import { tomeKeys } from './queryKeys'
import { STATUS_LABELS, cardCount } from './status'
import './tomes.css'

/** Every Tome on the shelf, newest first, with the form that binds another. */
export function TomesPage() {
  const query = useQuery({ queryKey: tomeKeys.list(), queryFn: listDecks })

  return (
    <section className="tomes">
      <PageHeader eyebrow="The Bindery" title="The Tomes" />
      <TomeCreateForm />

      {query.isPending && <Consulting>Taking down the Tomes…</Consulting>}
      {query.isError && (
        <Notice tone="danger" role="alert">
          The Tomes could not be read. {query.error.message}
        </Notice>
      )}
      {query.isSuccess && query.data.length === 0 && (
        <EmptyState title="No Tomes bound yet">
          Bind one above, then add its cards from the collection or the catalog.
        </EmptyState>
      )}
      {query.isSuccess && query.data.length > 0 && (
        <ul className="tomes__list" aria-label="Tomes">
          {query.data.map((deck) => (
            <li key={deck.id} className="tomes__entry">
              <Link to={`/tomes/${deck.id}`} className="tomes__name">
                {deck.name}
              </Link>
              <span className="tomes__meta">
                {deck.format ?? 'no format'} · {cardCount(deck.card_count)} ·{' '}
                {deck.claims_cards ? 'Claims its cards' : 'References only'}
              </span>
              <Tag tone={deck.status === 'active' ? 'success' : 'neutral'}>
                {STATUS_LABELS[deck.status]}
              </Tag>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
