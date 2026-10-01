import type { ComponentProps, ReactNode } from 'react'
import { cx } from './cx'
import { Seal } from './Seal'

export interface EmptyStateProps extends Omit<ComponentProps<'div'>, 'title'> {
  title: ReactNode
}

/**
 * What a view shows when it has nothing to list: an unpressed seal, a heading,
 * and a line that says where to go next. The seal keeps its wax but loses the
 * oxblood, so it reads as a motif, not a confirmation. No role; the heading names it.
 */
export function EmptyState({
  title,
  className,
  children,
  ...rest
}: EmptyStateProps) {
  return (
    <div className={cx('empty-state', className)} {...rest}>
      <Seal className="empty-state__seal" />
      <h2 className="empty-state__title">{title}</h2>
      <div className="empty-state__body">{children}</div>
    </div>
  )
}
