import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { BringInPage } from './BringInPage'

describe('BringInPage', () => {
  it('offers the decklist and the CSV import under one heading', () => {
    render(
      <MemoryRouter>
        <BringInPage />
      </MemoryRouter>,
    )

    expect(
      screen.getByRole('heading', { name: 'Bring in a Collection' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Inscribe a Decklist' }),
    ).toHaveAttribute('href', '/import/decklist')
    expect(
      screen.getByRole('link', { name: 'Import a Collection CSV' }),
    ).toHaveAttribute('href', '/import/csv')
  })
})
