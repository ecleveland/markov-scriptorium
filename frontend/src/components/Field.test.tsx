import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Field } from './Field'

describe('Field', () => {
  it('labels the wrapped control implicitly', () => {
    render(
      <Field label="Finish">
        <select>
          <option>nonfoil</option>
        </select>
      </Field>,
    )
    const select = screen.getByLabelText('Finish')
    expect(select.tagName).toBe('SELECT')
    expect(select.closest('label')).toHaveClass('field')
  })

  it('marks the label text so it can be styled apart from the control', () => {
    render(
      <Field label="Quantity">
        <input type="number" />
      </Field>,
    )
    expect(screen.getByText('Quantity')).toHaveClass('field__label')
  })

  it('merges a caller-supplied className', () => {
    render(
      <Field label="Notes" className="lot-editor__notes">
        <textarea />
      </Field>,
    )
    expect(screen.getByLabelText('Notes').closest('label')).toHaveClass(
      'field',
      'lot-editor__notes',
    )
  })
})
