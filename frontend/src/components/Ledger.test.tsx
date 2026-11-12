import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Ledger, LedgerEntry, LedgerFigure } from './Ledger'

function entry(number: number) {
  return (
    <LedgerEntry
      key={number}
      number={number}
      thumb={<span data-testid="thumb">art</span>}
      name={<a href="/catalog/1">Sol Ring</a>}
      where="Commander 2021, no. 263. Red binder"
      count={<LedgerFigure>4</LedgerFigure>}
      note="near mint"
    />
  )
}

describe('Ledger', () => {
  it('is an ordered list named by its label', () => {
    render(<Ledger aria-label="The catalog">{entry(1)}</Ledger>)
    const list = screen.getByRole('list', { name: 'The catalog' })
    expect(list.tagName).toBe('OL')
    expect(list).toHaveClass('ledger')
  })

  it('merges a caller className and passes attributes through', () => {
    render(
      <Ledger aria-label="The catalog" className="index__ledger" start={26}>
        {entry(26)}
      </Ledger>,
    )
    const list = screen.getByRole('list', { name: 'The catalog' })
    expect(list).toHaveClass('ledger', 'index__ledger')
    expect(list).toHaveAttribute('start', '26')
  })
})

describe('LedgerEntry', () => {
  it('lays out the number, thumb, body and count in order', () => {
    render(<Ledger aria-label="The catalog">{entry(7)}</Ledger>)
    const item = screen.getByRole('listitem')
    expect(item).toHaveClass('ledger__entry')
    expect([...item.children].map((child) => child.className)).toEqual([
      'ledger__number',
      'ledger__thumb',
      'ledger__body',
      'ledger__count',
    ])
  })

  it('hides the running number from assistive tech', () => {
    render(<Ledger aria-label="The catalog">{entry(7)}</Ledger>)
    const number = screen.getByRole('listitem').querySelector('.ledger__number')
    expect(number).toHaveTextContent('7')
    expect(number).toHaveAttribute('aria-hidden', 'true')
  })

  it('puts the name above the where line in the body', () => {
    render(<Ledger aria-label="The catalog">{entry(1)}</Ledger>)
    const item = screen.getByRole('listitem')
    const body = item.querySelector('.ledger__body')
    expect([...(body?.children ?? [])].map((child) => child.className)).toEqual(
      ['ledger__name', 'ledger__where'],
    )
    expect(
      within(item.querySelector('.ledger__name') as HTMLElement).getByRole(
        'link',
        { name: 'Sol Ring' },
      ),
    ).toHaveAttribute('href', '/catalog/1')
    expect(item.querySelector('.ledger__where')).toHaveTextContent(
      'Commander 2021, no. 263. Red binder',
    )
    expect(item.querySelector('.ledger__thumb')).toContainElement(
      screen.getByTestId('thumb'),
    )
  })

  it('sets the gold figure with the note beneath it', () => {
    render(<Ledger aria-label="The catalog">{entry(1)}</Ledger>)
    const count = screen.getByRole('listitem').querySelector('.ledger__count')
    expect(count?.querySelector('.ledger__figure')).toHaveTextContent('4')
    expect(count?.querySelector('.ledger__note')).toHaveTextContent('near mint')
  })

  it('leaves the note out when there is none', () => {
    render(
      <Ledger aria-label="The catalog">
        <LedgerEntry
          number={1}
          thumb={null}
          name="Sol Ring"
          where="Unshelved"
          count={<LedgerFigure>1</LedgerFigure>}
        />
      </Ledger>,
    )
    expect(document.querySelector('.ledger__note')).toBeNull()
  })

  it('merges a caller className onto the entry', () => {
    render(
      <Ledger aria-label="The catalog">
        <LedgerEntry
          number={1}
          thumb={null}
          name="Sol Ring"
          where="Unshelved"
          count="1"
          className="catalog__entry"
        />
      </Ledger>,
    )
    expect(screen.getByRole('listitem')).toHaveClass(
      'ledger__entry',
      'catalog__entry',
    )
  })
})
