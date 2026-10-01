import type { ComponentProps, ReactNode } from 'react'
import { cx } from './cx'
import { Seal } from './Seal'

export interface SealedProps extends Omit<ComponentProps<'div'>, 'title'> {
  /** The eyebrow above the message. Defaults to "Sealed into the catalog". */
  title?: ReactNode
}

/**
 * The confirmation moment: the wax seal pressed beside a short message, for a
 * write that landed (an inscribe, an import). Like Notice it carries no role
 * of its own, so a caller that needs it announced passes `role="status"`.
 */
export function Sealed({
  title = 'Sealed into the catalog',
  className,
  children,
  ...rest
}: SealedProps) {
  return (
    <div className={cx('sealed', className)} {...rest}>
      <Seal className="sealed__seal" />
      <div className="sealed__text">
        <p className="sealed__title">{title}</p>
        <div className="sealed__body">{children}</div>
      </div>
    </div>
  )
}
