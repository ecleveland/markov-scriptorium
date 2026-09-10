import type { ComponentProps, ElementType } from 'react'
import { cx } from './cx'

type PanelElement = 'div' | 'section' | 'aside' | 'fieldset'

// Typed as a fieldset (a superset of the div attributes) so `disabled`, `form`,
// and `name` type-check when `as="fieldset"`; on the other elements they are
// simply never passed.
interface PanelProps extends ComponentProps<'fieldset'> {
  /** The element to render; a `fieldset` should get a `<legend>` as its first child. */
  as?: PanelElement
}

/**
 * The bordered surface with the oxblood top-rule. Layout stays with the caller:
 * add a page class beside `panel` for flex or grid rather than styling `.panel`.
 */
export function Panel({ as = 'div', className, ...rest }: PanelProps) {
  // Cast rather than annotate: an annotation would narrow back to the literal
  // union and type the props against <div>.
  const Element = as as ElementType
  return <Element className={cx('panel', className)} {...rest} />
}
