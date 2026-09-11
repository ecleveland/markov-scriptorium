import type { ComponentProps, ElementType } from 'react'
import { cx } from './cx'

/**
 * Attributes and `ref` follow the element chosen with `as`, so `disabled`
 * only type-checks on a fieldset and a div ref only fits the default.
 */
export type PanelProps =
  | ({ as?: 'div' } & ComponentProps<'div'>)
  | ({ as: 'section' } & ComponentProps<'section'>)
  | ({ as: 'aside' } & ComponentProps<'aside'>)
  | ({ as: 'fieldset' } & ComponentProps<'fieldset'>)

/**
 * The bordered surface with the oxblood top-rule. Layout stays with the caller.
 * Add a page class beside `panel` for flex or grid rather than styling `.panel`.
 * A fieldset should get its `<legend>` as the first child.
 */
export function Panel({ as = 'div', className, ...rest }: PanelProps) {
  // The union above has already matched the props to the element; the cast
  // only lets one JSX expression render whichever tag was chosen.
  const Element = as as ElementType
  return <Element className={cx('panel', className)} {...rest} />
}
