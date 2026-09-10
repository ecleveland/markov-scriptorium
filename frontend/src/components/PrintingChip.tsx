import { cx } from './cx'
import { describePrinting, type PrintingSummary } from './printing'

interface PrintingChipProps {
  printing: PrintingSummary & { image_uris: Record<string, string> | null }
  /** `sm` for dense candidate lists, `md` for the Inscribe printing picker. */
  size?: 'sm' | 'md'
  className?: string
}

/**
 * Card art beside "Set Name (SET) · #num". Meant to sit inside a listbox
 * option's button: the art is decorative (`alt=""`) so the option is named by
 * the printing text alone. When the catalog holds no art the thumbnail is
 * simply absent. The Catalog's `CardThumb` placeholder is not reused here on
 * purpose: its "(no image)" label would leak into every option's name.
 */
export function PrintingChip({
  printing,
  size = 'sm',
  className,
}: PrintingChipProps) {
  const art = printing.image_uris?.small
  return (
    <span className={cx('printing-chip', `printing-chip--${size}`, className)}>
      {art && (
        <img className="printing-chip__thumb" src={art} alt="" loading="lazy" />
      )}
      <span className="printing-chip__text">{describePrinting(printing)}</span>
    </span>
  )
}
