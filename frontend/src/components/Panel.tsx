import type { ComponentProps, ElementType } from 'react'
import { cx } from './cx'

type PanelElement = 'div' | 'section' | 'aside' | 'fieldset'

/**
 * Attributes and `ref` follow the element chosen with `as`, so `disabled`
 * only type-checks on a fieldset and a div ref only fits the default.
 */
export type PanelProps<T extends PanelElement = 'div'> = {
  as?: T
} & ComponentProps<T>

/**
 * The bordered surface with the oxblood top-rule. Layout stays with the caller.
 * Add a page class beside `panel` for flex or grid rather than styling `.panel`.
 * A fieldset should get its `<legend>` as the first child.
 */
export function Panel<T extends PanelElement = 'div'>({
  as,
  className,
  ...rest
}: PanelProps<T>) {
  // The generic has already matched the props to the element; the cast only
  // lets one JSX expression render whichever tag was chosen.
  const Element = (as ?? 'div') as ElementType
  return <Element className={cx('panel', className)} {...rest} />
}
