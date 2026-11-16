import { LedgerFigure } from '../components'
import { BOARD_LABELS, type BoardGroup } from './boards'

/**
 * A board's heading with a rubricated initial, and its copy count beside it
 * as a gold figure. The heading names the board's region, so the count stays
 * out of it; the hidden noun lets the figure read as "36 cards" aloud.
 */
export function BoardHead({
  id,
  group,
}: {
  id: string
  group: BoardGroup<unknown>
}) {
  return (
    <div className="tome-board__head">
      <h3 className="opening tome-board__title" id={id}>
        {BOARD_LABELS[group.board]}
      </h3>
      <span className="tome-board__count">
        <LedgerFigure>{group.copies}</LedgerFigure>
        <span className="visually-hidden">
          {group.copies === 1 ? ' card' : ' cards'}
        </span>
      </span>
    </div>
  )
}
