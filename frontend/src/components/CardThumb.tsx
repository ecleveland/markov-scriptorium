export interface CardThumbProps {
  /** Scryfall's `image_uris`, or null when the catalog holds no art. */
  images: Record<string, string> | null
  name: string
  /** `thumb` for list rows, `full` for a detail plate or an Index tile. */
  size?: 'thumb' | 'full'
}

/**
 * Card art from the catalog's stored `image_uris`. Plenty of rows have none
 * (the dev seed carries no images, and the bulk data leaves the field null on
 * multi-faced layouts), so the placeholder is a first-class state, not an
 * afterthought: a broken <img> in every row would read as a bug. It is a dark
 * plate in the card's proportions. At full size the card's name is set on it
 * in the display face, hidden from assistive tech because the label already
 * carries the name; a thumb is too small for text and stays blank.
 */
export function CardThumb({ images, name, size = 'thumb' }: CardThumbProps) {
  const src =
    size === 'full'
      ? (images?.normal ?? images?.large ?? images?.small ?? null)
      : (images?.small ?? images?.normal ?? null)

  if (src === null) {
    return (
      <div
        className={`card-thumb card-thumb--${size} card-thumb--empty`}
        role="img"
        aria-label={`${name} (no image in the catalog)`}
      >
        {size === 'full' && (
          <span className="card-thumb__name" aria-hidden="true">
            {name}
          </span>
        )}
      </div>
    )
  }

  return (
    <img
      className={`card-thumb card-thumb--${size}`}
      src={src}
      alt={name}
      loading="lazy"
    />
  )
}
