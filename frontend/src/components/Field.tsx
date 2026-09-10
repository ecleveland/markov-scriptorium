import type { ComponentProps, ReactNode } from 'react'
import { cx } from './cx'

interface FieldProps extends ComponentProps<'label'> {
  label: ReactNode
}

/**
 * A labelled form control. The label wraps the control, so the association is
 * implicit and needs no ids; screen readers and `getByLabelText` both find the
 * control by its label text.
 */
export function Field({ label, className, children, ...rest }: FieldProps) {
  return (
    <label className={cx('field', className)} {...rest}>
      <span className="field__label">{label}</span>
      {children}
    </label>
  )
}
