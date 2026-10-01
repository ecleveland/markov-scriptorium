import type { ComponentProps } from 'react'
import { cx } from './cx'

export type SealProps = ComponentProps<'svg'>

/**
 * The house crest pressed into oxblood wax: a scalloped blob, a gold ring, and
 * an "M" monogram. Decorative, so it is hidden from assistive tech and carries
 * no role. The consumer sizes it; `.seal` sets only the display.
 */
export function Seal({ className, ...rest }: SealProps) {
  return (
    <svg
      className={cx('seal', className)}
      viewBox="0 0 48 48"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path
        className="seal__wax"
        d="M24 2.5c2.6 0 4.6 2.4 7.1 3 2.6.7 5.7-.3 7.8 1.3 2 1.6 2 4.8 3.5 6.9 1.5 2 4.5 3.2 5.2 5.7.7 2.5-1.1 5.1-1.1 7.6s1.8 5.1 1.1 7.6c-.7 2.5-3.7 3.7-5.2 5.7-1.5 2.1-1.5 5.3-3.5 6.9-2.1 1.6-5.2.6-7.8 1.3-2.5.6-4.5 3-7.1 3s-4.6-2.4-7.1-3c-2.6-.7-5.7.3-7.8-1.3-2-1.6-2-4.8-3.5-6.9-1.5-2-4.5-3.2-5.2-5.7C-.8 32.1 1 29.5 1 27s-1.8-5.1-1.1-7.6c.7-2.5 3.7-3.7 5.2-5.7 1.5-2.1 1.5-5.3 3.5-6.9 2.1-1.6 5.2-.6 7.8-1.3 2.5-.6 4.5-3 7.1-3z"
      />
      <circle className="seal__ring" cx="24" cy="24" r="14.5" />
      <text className="seal__mark" x="24" y="24" dy="0.35em">
        M
      </text>
    </svg>
  )
}
