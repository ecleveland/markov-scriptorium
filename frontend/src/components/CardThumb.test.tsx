import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CardThumb } from './CardThumb'

const images = {
  small: 'https://img.test/small.jpg',
  normal: 'https://img.test/normal.jpg',
  large: 'https://img.test/large.jpg',
}

describe('CardThumb', () => {
  it('renders the art named by the card', () => {
    render(<CardThumb images={images} name="Lightning Bolt" />)
    const img = screen.getByRole('img', { name: 'Lightning Bolt' })
    expect(img.tagName).toBe('IMG')
    expect(img).toHaveClass('card-thumb', 'card-thumb--thumb')
  })

  it('stands a labelled placeholder in for a card with no art', () => {
    render(<CardThumb images={null} name="Sol Ring" />)
    const placeholder = screen.getByRole('img', {
      name: 'Sol Ring (no image in the catalog)',
    })
    expect(placeholder).toHaveClass('card-thumb--empty')
  })

  it('picks the small image for a thumb and the normal one for a plate', () => {
    const { rerender } = render(
      <CardThumb images={images} name="Lightning Bolt" />,
    )
    expect(screen.getByRole('img')).toHaveAttribute('src', images.small)

    rerender(<CardThumb images={images} name="Lightning Bolt" size="full" />)
    const plate = screen.getByRole('img')
    expect(plate).toHaveAttribute('src', images.normal)
    expect(plate).toHaveClass('card-thumb--full')
  })

  it('falls back to whichever size the card has', () => {
    render(
      <CardThumb
        images={{ large: images.large }}
        name="Lightning Bolt"
        size="full"
      />,
    )
    expect(screen.getByRole('img')).toHaveAttribute('src', images.large)
  })
})
