import type { ComponentProps } from 'react'
import { cx } from './cx'

// Thin wrappers over the native controls. Each adds the `control` class and
// nothing else; behaviour, refs, and every attribute pass straight through.

/**
 * For text-like inputs (text, search, number, date, and so on). The `control`
 * rules are text-field rules; checkboxes, radios, ranges, and file pickers
 * keep their native rendering and should not use it.
 */
export function Input({ className, ...rest }: ComponentProps<'input'>) {
  return <input className={cx('control', className)} {...rest} />
}

export function Select({ className, ...rest }: ComponentProps<'select'>) {
  return <select className={cx('control', className)} {...rest} />
}

export function Textarea({ className, ...rest }: ComponentProps<'textarea'>) {
  return <textarea className={cx('control', className)} {...rest} />
}
