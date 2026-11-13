import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FinishWord } from './FinishWord'

describe('FinishWord', () => {
  it.each(['foil', 'etched'])('names a %s folio', (finish) => {
    const { container } = render(<FinishWord finish={finish} />)
    const word = container.firstElementChild
    expect(word?.tagName).toBe('SPAN')
    expect(word).toHaveClass('finish-word')
    expect(word).toHaveTextContent(finish)
  })

  it.each(['nonfoil', 'glossy', ''])('renders nothing for "%s"', (finish) => {
    const { container } = render(<FinishWord finish={finish} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('leaves the leading space to the caller', () => {
    const { container } = render(<FinishWord finish="foil" />)
    expect(container.textContent).toBe('foil')
  })
})
