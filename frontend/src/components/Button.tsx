import type { ComponentProps } from 'react'
import { cx } from './cx'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

export interface ButtonProps extends ComponentProps<'button'> {
  /** `secondary` unless told otherwise; `primary` is the one action on a screen. */
  variant?: ButtonVariant
  /**
   * Press the wax seal beside the label. Reserved for the signature Inscribe
   * action, so it renders only with `variant="primary"` and is ignored
   * elsewhere. A flat prop rather than a union: `Omit` and `Pick` collapse a
   * union and lose the rule, and the rule is cheap to hold at render time.
   */
  seal?: boolean
}

/** A small wax seal, a wax disc with a gold ring pressed into it. Decorative. */
function WaxSealGlyph() {
  return (
    <svg
      className="btn__seal"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <circle className="btn__seal-wax" cx="12" cy="12" r="11" />
      <circle className="btn__seal-ring" cx="12" cy="12" r="6.5" />
    </svg>
  )
}

/**
 * The scriptorium's button. Defaults to `type="button"` so a stray click inside
 * a form never submits it; pass `type="submit"` on purpose.
 */
export function Button({
  variant = 'secondary',
  seal = false,
  type = 'button',
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx('btn', `btn--${variant}`, className)}
      {...rest}
    >
      {seal && variant === 'primary' && <WaxSealGlyph />}
      {children}
    </button>
  )
}
