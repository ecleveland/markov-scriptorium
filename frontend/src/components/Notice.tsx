import type { ComponentProps } from 'react'
import { cx } from './cx'

export type NoticeTone = 'danger' | 'success' | 'muted'

export interface NoticeProps extends ComponentProps<'p'> {
  tone?: NoticeTone
}

/**
 * A line of secondary text about the page's state: an error, a confirmation, or
 * a quiet aside. Like Tag it carries no role of its own, so a caller that needs
 * the line announced passes `role="alert"` or `role="status"`.
 */
export function Notice({ tone = 'muted', className, ...rest }: NoticeProps) {
  return <p className={cx('notice', `notice--${tone}`, className)} {...rest} />
}
