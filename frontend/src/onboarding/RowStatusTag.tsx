import type { CardPrinting } from '../api'
import { Tag } from '../components'

interface Props {
  status: 'matched' | 'ambiguous' | 'unmatched'
  chosen: CardPrinting | null
}

/**
 * Where an import preview row stands, as a pill. Ready once it carries a
 * printing, which is what both the decklist and the CSV flow inscribe on. Page
 * local rather than part of the component layer: the ready / choose printing /
 * unmatched vocabulary belongs to the importers.
 */
export function RowStatusTag({ status, chosen }: Props) {
  if (status === 'unmatched') return <Tag tone="danger">unmatched</Tag>
  if (status === 'ambiguous' && !chosen)
    return <Tag tone="warning">choose printing</Tag>
  return <Tag tone="success">ready</Tag>
}
