import { cx } from './cx'
import { Notice, type NoticeProps } from './Notice'

export type ConsultingProps = Omit<NoticeProps, 'tone'>

/**
 * The loading line: a muted Notice with a candle burning before the text.
 * No role by default, like the plain loading lines it replaces; a caller that
 * wants the wait announced passes `role="status"`.
 */
export function Consulting({ className, children, ...rest }: ConsultingProps) {
  return (
    <Notice className={cx('consulting', className)} {...rest}>
      <span className="consulting__candle" aria-hidden="true" />
      {children ?? 'Consulting the catalog…'}
    </Notice>
  )
}
