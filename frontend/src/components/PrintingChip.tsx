import { cx } from './cx'
import { describePrinting, type PrintingChipPrinting } from './printing'

export type { PrintingChipPrinting }

export interface PrintingChipProps {
  printing: PrintingChipPrinting
  /** `sm` for dense candidate lists, `md` for the Inscribe printing picker. */
  size?: 'sm' | 'md'
}

/**
 * Card art beside "Set Name (SET) · #num". Meant to sit inside a listbox
 * option's button. The art is decorative (`alt=""`) so the option is named by
 * the printing text alone. When the row holds no `image_uris` (the dev seed,
 * and multi-faced printings whose art is stored per face) the thumbnail is
 * simply absent. The Catalog's `CardThumb` placeholder is not reused here on
 * purpose, since its "(no image)" label would leak into every option's name.
 */
export function PrintingChip({ printing, size = 'sm' }: PrintingChipProps) {
  const art = printing.image_uris?.small
  return (
    <span className={cx('printing-chip', `printing-chip--${size}`)}>
      {art && (
        <img
          className="printing-chip__thumb"
          src={art}
          alt=""
          loading="lazy"
          // The slot is reserved for the card's proportions while the image
          // loads; if the art never arrives, give the space back.
          onError={(event) => {
            event.currentTarget.hidden = true
          }}
        />
      )}
      <span className="printing-chip__text">{describePrinting(printing)}</span>
    </span>
  )
}
