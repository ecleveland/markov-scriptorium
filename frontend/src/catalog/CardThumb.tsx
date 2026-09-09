interface CardThumbProps {
  images: Record<string, string> | null
  name: string
  /** `thumb` for list rows, `full` for the detail view's plate. */
  size?: 'thumb' | 'full'
}

/**
 * Card art from the catalog's stored `image_uris`. Plenty of rows have none
 * (the dev seed carries no images, and the bulk data leaves the field null on
 * multi-faced layouts), so the placeholder is a first-class state, not an
 * afterthought: a broken <img> in every row would read as a bug.
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
        <span aria-hidden="true">✦</span>
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
