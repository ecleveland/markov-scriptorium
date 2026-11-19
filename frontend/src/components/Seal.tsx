import type { ComponentProps } from 'react'
import { cx } from './cx'

export type SealProps = ComponentProps<'svg'>

/**
 * The house seal as an impression in oxblood wax. The wax spreads into an
 * uneven lip, the die presses a darker field into its middle, and a lit edge
 * catches the upper left of the lip. Inside the field sit a gold ring and a
 * serifed "M" drawn as strokes, so the mark never depends on the display font.
 *
 * Geometry lives here and colour lives in components.css. Decorative, so it is
 * hidden from assistive tech and carries no role. The consumer sizes it, and
 * `.seal` sets only the display. After changing the drawing, rerun
 * scripts/render-icons.mjs and redraw public/favicon.svg to match.
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
        d="M24.00 2.50 C27.70 2.44 32.20 2.75 35.20 4.60 C38.20 6.45 40.21 10.37 42.01 13.60 C43.81 16.83 45.88 20.47 46.00 24.00 C46.12 27.53 44.66 31.83 42.71 34.80 C40.76 37.77 37.42 39.92 34.30 41.84 C31.18 43.76 27.48 46.21 24.00 46.30 C20.52 46.39 16.42 44.33 13.40 42.36 C10.38 40.38 7.82 37.51 5.90 34.45 C3.98 31.39 1.97 27.53 1.90 24.00 C1.83 20.48 3.62 16.48 5.47 13.30 C7.32 10.12 9.91 6.75 13.00 4.95 C16.09 3.15 20.30 2.56 24.00 2.50 Z"
      />
      <path
        className="seal__field"
        d="M24.00 6.80 C28.10 6.75 33.61 8.69 36.45 11.55 C39.28 14.42 41.01 19.86 41.00 24.00 C40.99 28.14 39.21 33.49 36.37 36.37 C33.54 39.26 28.08 41.35 24.00 41.30 C19.92 41.25 14.84 38.97 11.91 36.09 C8.98 33.21 6.41 28.04 6.40 24.00 C6.39 19.96 8.90 14.70 11.84 11.84 C14.77 8.97 19.90 6.85 24.00 6.80 Z"
      />
      <path
        className="seal__lit"
        d="M8.2 13.6 C11.6 8.6 17.2 5.2 23.2 4.6"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <circle
        className="seal__ring"
        cx="24"
        cy="24"
        r="14.6"
        strokeWidth="0.9"
      />
      <g className="seal__mark">
        {/* Stems and diagonals, then the serifs. */}
        <path
          d="M16.3 16.4 L15.2 32.2 M16.3 16.4 L24 29.6 L31.7 16.4 M31.7 16.4 L32.8 32.2"
          strokeWidth="3"
          strokeLinejoin="miter"
        />
        <path
          d="M12.2 32.6 H18.4 M29.6 32.6 H35.8 M13 16 H17 M31 16 H35"
          strokeWidth="1.5"
        />
      </g>
    </svg>
  )
}
