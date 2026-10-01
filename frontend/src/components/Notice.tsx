import type { ComponentProps } from 'react'
import { cx } from './cx'

export type NoticeTone = 'danger' | 'success' | 'muted'

export interface NoticeProps extends ComponentProps<'p'> {
  tone?: NoticeTone
  /**
   * `span` lets the line sit inline in a button row or a table cell, where a
   * paragraph is not allowed. A span takes the same attributes we pass a `p`,
   * so the props stay typed as the paragraph's.
   */
  as?: 'p' | 'span'
}

/**
 * A line of secondary text about the page's state: an error, a confirmation, or
 * a quiet aside. Like Tag it carries no role of its own, so a caller that needs
 * the line announced passes `role="alert"` or `role="status"`.
 */
export function Notice({
  tone = 'muted',
  as: Root = 'p',
  className,
  ...rest
}: NoticeProps) {
  return (
    <Root
      className={cx(
        'notice',
        `notice--${tone}`,
        Root === 'span' && 'notice--inline',
        className,
      )}
      {...rest}
    />
  )
}
