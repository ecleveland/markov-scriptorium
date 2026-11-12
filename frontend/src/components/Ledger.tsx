import type { ComponentProps, ReactNode } from 'react'
import { cx } from './cx'

export interface LedgerProps extends ComponentProps<'ol'> {
  'aria-label': string
}

/**
 * The Index and the Catalog as a ledger (VEG-624): an ordered list of
 * entries divided by hairline rules, with no boxes and no hover fill.
 */
export function Ledger({ className, children, ...rest }: LedgerProps) {
  return (
    <ol className={cx('ledger', className)} {...rest}>
      {children}
    </ol>
  )
}

export interface LedgerEntryProps {
  /** The running number, 1-based across pages: offset + index + 1. */
  number: number
  /** A <CardThumb> from the caller. */
  thumb: ReactNode
  /** The name link, plus an optional <FinishWord>. */
  name: ReactNode
  /** The italic printing-and-shelf line. */
  where: ReactNode
  /** The gold figure, or a stepper. */
  count: ReactNode
  /** A small line under the count: condition, Tome claim. */
  note?: ReactNode
  className?: string
}

/**
 * One line of the ledger. The rubric number is ornament, so it is hidden from
 * assistive tech; the list itself already says where an entry falls.
 */
export function LedgerEntry({
  number,
  thumb,
  name,
  where,
  count,
  note,
  className,
}: LedgerEntryProps) {
  return (
    <li className={cx('ledger__entry', className)}>
      <span className="ledger__number" aria-hidden="true">
        {number}
      </span>
      <span className="ledger__thumb">{thumb}</span>
      <div className="ledger__body">
        <div className="ledger__name">{name}</div>
        <div className="ledger__where">{where}</div>
      </div>
      <div className="ledger__count">
        {count}
        {/* Only an absent note skips the line; 0 and '' are content. */}
        {note != null && note !== false && (
          <span className="ledger__note">{note}</span>
        )}
      </div>
    </li>
  )
}

/** The gold count at the end of a ledger entry. */
export function LedgerFigure({ children }: { children: ReactNode }) {
  return <span className="ledger__figure">{children}</span>
}
