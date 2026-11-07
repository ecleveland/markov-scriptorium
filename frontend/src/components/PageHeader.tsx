import type { ComponentProps, ReactNode } from 'react'
import { cx } from './cx'

export interface PageHeaderProps extends Omit<
  ComponentProps<'header'>,
  'title'
> {
  /**
   * The heading text. A node, so a page can set one word in rubric with
   * `<span className="rubric">`.
   */
  title: ReactNode
  /** `1` for a page's own heading, `2` for a heading inside one. */
  level?: 1 | 2
  /** Actions sitting beside the title, typically one Button. */
  children?: ReactNode
}

/**
 * The heading block every page opens with: the title and the actions that
 * belong to it. The page's running title lives in the leaf margin, which the
 * route draws (App.tsx). Typography comes from index.css and App.css, so this
 * only lays the parts out.
 */
export function PageHeader({
  title,
  level = 1,
  className,
  children,
  ...rest
}: PageHeaderProps) {
  const Heading = level === 1 ? 'h1' : 'h2'
  return (
    <header className={cx('page-header', className)} {...rest}>
      <div className="page-header__heading">
        <Heading className="page-header__title">{title}</Heading>
      </div>
      {/* Only an absent child skips the wrapper; 0 and '' are content. */}
      {children != null && children !== false && (
        <div className="page-header__actions">{children}</div>
      )}
    </header>
  )
}
