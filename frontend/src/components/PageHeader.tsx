import type { ComponentProps, ReactNode } from 'react'
import { cx } from './cx'

export interface PageHeaderProps extends Omit<
  ComponentProps<'header'>,
  'title'
> {
  /** The small uppercase line above the title, naming the flow. */
  eyebrow?: string
  title: ReactNode
  /** `1` for a page's own heading, `2` for a heading inside one. */
  level?: 1 | 2
  /** Actions sitting beside the title, typically one Button. */
  children?: ReactNode
}

/**
 * The heading block every page opens with: an optional eyebrow, the title, and
 * the actions that belong to it. Typography comes from index.css and App.css,
 * so this only lays the parts out.
 */
export function PageHeader({
  eyebrow,
  title,
  level = 1,
  className,
  children,
  ...rest
}: PageHeaderProps) {
  const Heading = level === 1 ? 'h1' : 'h2'
  return (
    <header className={cx('page-header', className)} {...rest}>
      <div>
        {eyebrow && <p className="page-header__eyebrow">{eyebrow}</p>}
        <Heading className="page-header__title">{title}</Heading>
      </div>
      {children && <div className="page-header__actions">{children}</div>}
    </header>
  )
}
