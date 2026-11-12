import type { ReactNode } from 'react'
import { cx } from './cx'

export interface PlateProps {
  /** A <CardThumb size="full"> from the caller. */
  art: ReactNode
  /** The <h1> or <h2> the caller renders: the name plus a <FinishWord>. */
  heading: ReactNode
  /** The prose <p>s. Put `plate__printing` on the printing line. */
  lines: ReactNode
  /** Buttons or links beneath the lines. */
  actions?: ReactNode
  /** When given, the plate is a <section> with this label; else a <header>. */
  label?: string
  className?: string
}

/**
 * The lit plate (VEG-624): large card art beside its name and a few lines of
 * prose, under the app's one glow. The Index opens with the newest
 * inscription on one, and a lot's page opens with the lot.
 */
export function Plate({
  art,
  heading,
  lines,
  actions,
  label,
  className,
}: PlateProps) {
  const body = (
    <>
      <div className="plate__art">{art}</div>
      <div className="plate__text">
        {heading}
        {lines}
        {actions != null && actions !== false && (
          <div className="plate__actions">{actions}</div>
        )}
      </div>
    </>
  )
  const classes = cx('plate', className)
  return label === undefined ? (
    <header className={classes}>{body}</header>
  ) : (
    <section className={classes} aria-label={label}>
      {body}
    </section>
  )
}
