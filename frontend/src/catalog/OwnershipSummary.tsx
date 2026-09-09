import { useQuery } from '@tanstack/react-query'
import { ownedForPrinting } from '../api'
import { inventoryKeys } from './queryKeys'

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

/**
 * How much of this *card* the collection holds, counting every printing of it.
 *
 * The lot above answers "this folio"; this answers "do I already own this card
 * somewhere else", which is the question you actually have with a binder open.
 */
export function OwnershipSummary({ scryfallId }: { scryfallId: string }) {
  const query = useQuery({
    queryKey: inventoryKeys.ownership(scryfallId),
    queryFn: () => ownedForPrinting(scryfallId),
  })

  if (query.isPending) {
    return <p className="ownership__pending">Counting copies…</p>
  }
  if (query.isError) {
    return (
      <p className="ownership__error" role="alert">
        Ownership could not be counted. {query.error.message}
      </p>
    )
  }

  const across = query.data.across_printings
  if (across === null) return null

  const copies = plural(across.total_quantity, 'copy', 'copies')
  const sentence =
    across.printing_count <= 1
      ? `You own ${copies} of ${across.name}, all in this printing.`
      : `You own ${copies} of ${across.name} across ${plural(
          across.printing_count,
          'printing',
          'printings',
        )}.`

  return (
    <aside className="ownership" aria-label="Ownership across printings">
      <p className="ownership__sentence">{sentence}</p>
      {across.printing_count > 1 && (
        <ul className="ownership__printings">
          {across.printings.map((printing) => (
            <li
              key={printing.scryfall_id}
              aria-current={
                printing.scryfall_id === scryfallId ? 'true' : undefined
              }
            >
              {printing.quantity}× {printing.set_name} (
              {printing.set_code.toUpperCase()} #{printing.collector_number})
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}
