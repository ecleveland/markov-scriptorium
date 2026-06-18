import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CardPrinting, ParseResult, ResolveResponse } from '../api'
import { DecklistPage } from './DecklistPage'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return {
    ...actual,
    parseDecklist: vi.fn(),
    resolveDecklist: vi.fn(),
    inscribeBulk: vi.fn(),
  }
})

import { inscribeBulk, parseDecklist, resolveDecklist } from '../api'

const parseMock = vi.mocked(parseDecklist)
const resolveMock = vi.mocked(resolveDecklist)
const inscribeMock = vi.mocked(inscribeBulk)

function printing(overrides: Partial<CardPrinting>): CardPrinting {
  return {
    scryfall_id: 'id',
    name: 'Lightning Bolt',
    set_code: 'lea',
    set_name: 'Limited Edition Alpha',
    collector_number: '161',
    rarity: 'common',
    finishes: ['nonfoil', 'foil'],
    image_uris: null,
    ...overrides,
  }
}

function parsed(
  entries: ParseResult['entries'],
  problems: ParseResult['problems'] = [],
): ParseResult {
  return { entries, problems }
}

afterEach(() => vi.clearAllMocks())

async function resolveText(text: string) {
  const user = userEvent.setup()
  render(<DecklistPage />)
  await user.type(screen.getByLabelText('Decklist'), text)
  await user.click(screen.getByRole('button', { name: 'Resolve decklist' }))
  return user
}

describe('DecklistPage', () => {
  it('parses, resolves, disambiguates, and bulk-inscribes', async () => {
    parseMock.mockResolvedValue(
      parsed([
        {
          line_number: 1,
          name: 'Sol Ring',
          quantity: 1,
          set_code: null,
          collector_number: null,
        },
        {
          line_number: 2,
          name: 'Lightning Bolt',
          quantity: 4,
          set_code: null,
          collector_number: null,
        },
        {
          line_number: 3,
          name: 'Black Lotus',
          quantity: 1,
          set_code: null,
          collector_number: null,
        },
      ]),
    )
    const resolveResponse: ResolveResponse = {
      results: [
        {
          input: { name: 'Sol Ring', quantity: 1 },
          status: 'matched',
          match: printing({
            scryfall_id: 'sol-1',
            name: 'Sol Ring',
            set_name: 'Commander',
          }),
          candidates: [],
        },
        {
          input: { name: 'Lightning Bolt', quantity: 4 },
          status: 'ambiguous',
          match: null,
          candidates: [
            printing({
              scryfall_id: 'lea-bolt',
              set_name: 'Limited Edition Alpha',
            }),
            printing({
              scryfall_id: 'm10-bolt',
              set_name: 'Magic 2010',
              set_code: 'm10',
            }),
          ],
        },
        {
          input: { name: 'Black Lotus', quantity: 1 },
          status: 'unmatched',
          match: null,
          candidates: [],
        },
      ],
      summary: { matched: 1, ambiguous: 1, unmatched: 1 },
    }
    resolveMock.mockResolvedValue(resolveResponse)
    inscribeMock.mockResolvedValue({ created: [], count: 2 })

    const user = await resolveText('Sol Ring\n4 Lightning Bolt\nBlack Lotus')

    // Preview appeared with the three groups represented.
    expect(
      await screen.findByRole('heading', { name: 'Review the Decklist' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/No printing of .*Black Lotus/)).toBeInTheDocument()

    // One match is ready; the ambiguous Bolt is not yet — so 1 ready.
    const inscribeButton = screen.getByRole('button', {
      name: /Inscribe 1 folio/,
    })
    expect(inscribeButton).toBeEnabled()

    // Choose the LEA printing for the ambiguous Lightning Bolt.
    await user.click(
      screen.getByRole('button', { name: /Limited Edition Alpha/ }),
    )
    const readyButton = await screen.findByRole('button', {
      name: /Inscribe 2 folios/,
    })

    // Pick a batch finish, then inscribe.
    await user.selectOptions(screen.getByLabelText('Finish'), 'foil')
    await user.click(readyButton)

    await waitFor(() =>
      expect(inscribeMock).toHaveBeenCalledWith([
        { scryfall_id: 'sol-1', quantity: 1, finish: 'foil', condition: 'NM' },
        {
          scryfall_id: 'lea-bolt',
          quantity: 4,
          finish: 'foil',
          condition: 'NM',
        },
      ]),
    )

    // Summary reports inscribed folios/copies and the one skipped (unmatched) line.
    const summary = await screen.findByRole('status')
    expect(summary).toHaveTextContent(/Inscribed 2 folios \(5 copies\)/)
    expect(summary).toHaveTextContent(/1 line skipped/)
  })

  it('reports unreadable lines and blocks when nothing parses', async () => {
    parseMock.mockResolvedValue(
      parsed(
        [],
        [{ line_number: 1, text: '4', reason: 'quantity with no card name' }],
      ),
    )
    await resolveText('4')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /No readable card lines/,
    )
    const problems = screen.getByRole('complementary', {
      name: 'Unreadable lines',
    })
    expect(within(problems).getByText(/Line 1:/)).toBeInTheDocument()
    expect(resolveMock).not.toHaveBeenCalled()
  })

  it('surfaces a bulk-inscribe failure without leaving the preview', async () => {
    parseMock.mockResolvedValue(
      parsed([
        {
          line_number: 1,
          name: 'Sol Ring',
          quantity: 1,
          set_code: null,
          collector_number: null,
        },
      ]),
    )
    resolveMock.mockResolvedValue({
      results: [
        {
          input: { name: 'Sol Ring', quantity: 1 },
          status: 'matched',
          match: printing({ scryfall_id: 'sol-1', name: 'Sol Ring' }),
          candidates: [],
        },
      ],
      summary: { matched: 1, ambiguous: 0, unmatched: 0 },
    })
    const { ApiError } =
      await vi.importActual<typeof import('../api')>('../api')
    inscribeMock.mockRejectedValue(
      new ApiError('nothing imported', 422, 'nothing imported'),
    )

    const user = await resolveText('Sol Ring')
    await user.click(
      await screen.findByRole('button', { name: /Inscribe 1 folio/ }),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'nothing imported',
    )
    expect(
      screen.getByRole('heading', { name: 'Review the Decklist' }),
    ).toBeInTheDocument()
  })
})
