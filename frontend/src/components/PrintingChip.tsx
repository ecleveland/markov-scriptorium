import { useState } from 'react'
import { cx } from './cx'
import { describePrinting, type PrintingSummary } from './printing'

export interface PrintingChipProps {
  printing: PrintingSummary
  /** `sm` for dense candidate lists, `md` for the Inscribe printing picker. */
  size?: 'sm' | 'md'
}

/**
 * Card art beside "Set Name (SET) · #num". Meant to sit inside a listbox
 * option's button. The art is decorative (`alt=""`) so the option is named by
 * the printing text alone. When the row holds no `image_uris` (the dev seed,
 * and multi-faced printings whose art is stored per face) or the image fails
 * to load, an empty slot of the same width keeps every row in a list aligned.
 * The slot carries no label, which is why the Catalog's `CardThumb` (whose
 * "(no image)" label would join the option's name) is not reused here.
 */
export function PrintingChip({ printing, size = 'sm' }: PrintingChipProps) {
  const [failed, setFailed] = useState(false)
  const art = printing.image_uris?.small
  return (
    <span className={cx('printing-chip', `printing-chip--${size}`)}>
      {art && !failed ? (
        <img
          className="printing-chip__thumb"
          src={art}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <span
          className="printing-chip__thumb printing-chip__thumb--empty"
          aria-hidden="true"
        />
      )}
      <span className="printing-chip__text">{describePrinting(printing)}</span>
    </span>
  )
}
