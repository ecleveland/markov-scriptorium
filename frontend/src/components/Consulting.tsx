import { cx } from './cx'
import { Notice, type NoticeProps } from './Notice'

// No `as`: the candle is a flex row, which an inline span cannot be.
export type ConsultingProps = Omit<NoticeProps, 'tone' | 'as'>

/**
 * The loading line: a muted Notice with a candle burning before the text.
 * No role by default, like the plain loading lines it replaces; a caller that
 * wants the wait announced passes `role="status"`.
 */
export function Consulting({ className, children, ...rest }: ConsultingProps) {
  return (
    <Notice className={cx('consulting', className)} {...rest}>
      <span className="consulting__candle" aria-hidden="true" />
      {/* One span, so markup passed as children stays one flex item. */}
      <span className="consulting__text">
        {children ?? 'Consulting the catalog…'}
      </span>
    </Notice>
  )
}
