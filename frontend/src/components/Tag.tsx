import type { ComponentProps } from 'react'
import { cx } from './cx'

export type TagTone = 'neutral' | 'success' | 'warning' | 'danger'

interface TagProps extends ComponentProps<'span'> {
  tone?: TagTone
}

/**
 * A status pill. Tones carry the import-preview vocabulary: `success` for a
 * row that is ready, `warning` for one that still needs a printing chosen,
 * `danger` for one that matched nothing. Plain span, no ARIA role: a tag
 * describes state, it does not announce it.
 */
export function Tag({ tone = 'neutral', className, ...rest }: TagProps) {
  return <span className={cx('tag', `tag--${tone}`, className)} {...rest} />
}
