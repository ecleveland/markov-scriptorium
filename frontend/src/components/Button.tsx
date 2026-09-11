import type { ComponentProps } from 'react'
import { cx } from './cx'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

/**
 * `secondary` unless told otherwise; `primary` is the one action on a screen.
 * The wax seal is reserved for the signature Inscribe action, so it is only
 * accepted alongside `variant="primary"`.
 */
export type ButtonProps = ComponentProps<'button'> &
  (
    | { variant?: Exclude<ButtonVariant, 'primary'>; seal?: never }
    | { variant: 'primary'; seal?: boolean }
  )

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
      {seal && <WaxSealGlyph />}
      {children}
    </button>
  )
}
