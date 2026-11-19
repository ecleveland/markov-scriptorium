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

/** The echoed RawEntry the backend returns on each resolve result. */
function inputOf(name: string, quantity: number) {
  return { name, quantity, finish: null, condition: null, language: null }
}

afterEach(() => vi.clearAllMocks())

/** The ledger's own entries, leaving out the candidate picker's options. */
function entriesOf(list: HTMLElement): HTMLElement[] {
  return Array.from(list.children) as HTMLElement[]
}

async function resolveText(text: string) {
  const user = userEvent.setup()
  render(<DecklistPage />)
  await user.type(screen.getByLabelText('Decklist'), text)
  await user.click(screen.getByRole('button', { name: 'Resolve decklist' }))
  return user
}

describe('DecklistPage', () => {
  it('asks for a decklist without dashes in the instructions', () => {
    render(<DecklistPage />)
    expect(
      screen.getByText(/Paste a decklist, one card per line, such as/),
    ).toBeInTheDocument()
  })

  it('lays the preview out as a ledger under a summary sentence', async () => {
    parseMock.mockResolvedValue(
      parsed(
        [
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
        ],
        [{ line_number: 4, text: '4', reason: 'quantity with no card name' }],
      ),
    )
    resolveMock.mockResolvedValue({
      results: [
        {
          input: inputOf('Sol Ring', 1),
          status: 'matched',
          match: printing({
            scryfall_id: 'sol-1',
            name: 'Sol Ring',
            set_name: 'Commander 2021',
            collector_number: '263',
          }),
          candidates: [],
        },
        {
          input: inputOf('Lightning Bolt', 4),
          status: 'ambiguous',
          match: null,
          candidates: [
            printing({ scryfall_id: 'lea-bolt' }),
            printing({
              scryfall_id: 'm10-bolt',
              set_name: 'Magic 2010',
              set_code: 'm10',
              collector_number: '146',
            }),
          ],
        },
        {
          input: inputOf('Black Lotus', 1),
          status: 'unmatched',
          match: null,
          candidates: [],
        },
      ],
      summary: { matched: 1, ambiguous: 1, unmatched: 1 },
    })

    const user = await resolveText('Sol Ring\n4 Lightning Bolt\nBlack Lotus')
    await screen.findByRole('heading', { name: 'Review the Decklist' })

    expect(
      screen.getByText(
        'One ready, one to choose, one unmatched, one unreadable.',
      ),
    ).toHaveClass('import__summary')
    // The batch choices sit in a plain fieldset, not a panel.
    const controls = screen.getByRole('group', {
      name: 'Applied to every inscribed card',
    })
    expect(controls).toHaveClass('import__controls')
    expect(controls).not.toHaveClass('panel')

    const list = screen.getByRole('list', { name: 'Lines' })
    const [sol, bolt, lotus] = entriesOf(list)
    expect(entriesOf(list)).toHaveLength(3)

    // The status word opens the line, then the name as typed.
    const solName = sol.querySelector('.ledger__name') as HTMLElement
    expect(solName.firstElementChild).toHaveTextContent('ready')
    expect(solName.firstElementChild).toHaveClass('tag--success')
    expect(solName).toHaveTextContent('ready Sol Ring')
    expect(sol).toHaveTextContent('Commander 2021, no. 263.')
    expect(sol).toHaveTextContent('1 copy')

    const boltName = bolt.querySelector('.ledger__name') as HTMLElement
    expect(boltName.firstElementChild).toHaveTextContent('choose printing')
    expect(boltName.firstElementChild).toHaveClass('tag--warning')
    expect(bolt).toHaveTextContent('Several printings match; choose one below.')
    expect(bolt).toHaveTextContent('4 copies')
    // The picker rides on the entry's own line beneath it.
    expect(
      within(bolt).getByRole('list', { name: 'Printings of Lightning Bolt' }),
    ).toBeInTheDocument()

    const lotusName = lotus.querySelector('.ledger__name') as HTMLElement
    expect(lotusName.firstElementChild).toHaveTextContent('unmatched')
    expect(lotusName.firstElementChild).toHaveClass('tag--danger')
    expect(lotus).toHaveTextContent(
      'No printing of “Black Lotus” resides in the catalog.',
    )

    // Once chosen, the picker goes and the printing line carries a Change.
    await user.click(within(bolt).getByRole('button', { name: /Magic 2010/ }))
    expect(boltName.firstElementChild).toHaveTextContent('ready')
    expect(bolt).toHaveTextContent('Magic 2010, no. 146.')
    expect(
      within(bolt).getByRole('button', { name: 'Change' }),
    ).toBeInTheDocument()
    expect(within(bolt).queryByRole('list')).not.toBeInTheDocument()
    expect(
      screen.getByText(
        'Two ready, none to choose, one unmatched, one unreadable.',
      ),
    ).toBeInTheDocument()
  })

  it('sets a thumb only on lines with a chosen printing', async () => {
    const line = (line_number: number, name: string) => ({
      line_number,
      name,
      quantity: 1,
      set_code: null,
      collector_number: null,
    })
    parseMock.mockResolvedValue(
      parsed([
        line(1, 'Sol Ring'),
        line(2, 'Black Lotus'),
        line(3, 'Lightning Bolt'),
      ]),
    )
    resolveMock.mockResolvedValue({
      results: [
        {
          input: inputOf('Sol Ring', 1),
          status: 'matched',
          match: printing({ scryfall_id: 'sol-1', name: 'Sol Ring' }),
          candidates: [],
        },
        {
          input: inputOf('Black Lotus', 1),
          status: 'unmatched',
          match: null,
          candidates: [],
        },
        {
          input: inputOf('Lightning Bolt', 1),
          status: 'ambiguous',
          match: null,
          candidates: [
            printing({ scryfall_id: 'lea-bolt' }),
            printing({ scryfall_id: 'm10-bolt', set_name: 'Magic 2010' }),
          ],
        },
      ],
      summary: { matched: 1, ambiguous: 1, unmatched: 1 },
    })

    await resolveText('1 Sol Ring')
    const list = await screen.findByRole('list', { name: 'Lines' })
    const [sol, lotus, bolt] = entriesOf(list)

    const thumbOf = (entry: HTMLElement) =>
      entry.querySelector('.ledger__thumb') as HTMLElement
    expect(within(thumbOf(sol)).getByRole('img')).toBeInTheDocument()
    for (const entry of [lotus, bolt]) {
      // No printing chosen, so no plate claims the typed name has no art.
      expect(within(thumbOf(entry)).queryByRole('img')).toBeNull()
      expect(thumbOf(entry).firstElementChild).toHaveClass(
        'card-thumb',
        'card-thumb--thumb',
        'card-thumb--empty',
      )
      expect(thumbOf(entry).firstElementChild).toHaveAttribute(
        'aria-hidden',
        'true',
      )
    }
  })

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
          input: inputOf('Sol Ring', 1),
          status: 'matched',
          match: printing({
            scryfall_id: 'sol-1',
            name: 'Sol Ring',
            set_name: 'Commander',
          }),
          candidates: [],
        },
        {
          input: inputOf('Lightning Bolt', 4),
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
          input: inputOf('Black Lotus', 1),
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
    // The live region mounts empty on the preview step so the summary that
    // later fills it is announced.
    const region = screen.getByRole('status')
    expect(region).toBeEmptyDOMElement()
    expect(screen.getByText(/No printing of .*Black Lotus/)).toBeInTheDocument()
    // Some lines matched, so the empty state stays away.
    expect(screen.queryByText('Nothing matched')).not.toBeInTheDocument()

    // One match is ready and the ambiguous Bolt is not yet, so 1 ready.
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
    const summary = await screen.findByText(/Inscribed 2 folios \(5 copies\)/)
    // The same node that sat empty on the preview step now carries it.
    expect(summary.closest('[role="status"]')).toBe(region)
    expect(summary.closest('[role="status"]')).toHaveTextContent(
      /1 line skipped/,
    )
  })

  it('lets the user re-pick an ambiguous row via "Change"', async () => {
    parseMock.mockResolvedValue(
      parsed([
        {
          line_number: 1,
          name: 'Lightning Bolt',
          quantity: 4,
          set_code: null,
          collector_number: null,
        },
      ]),
    )
    resolveMock.mockResolvedValue({
      results: [
        {
          input: inputOf('Lightning Bolt', 4),
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
      ],
      summary: { matched: 0, ambiguous: 1, unmatched: 0 },
    })

    const user = await resolveText('4 Lightning Bolt')

    // Nothing chosen yet, so Inscribe is disabled.
    await screen.findByRole('heading', { name: 'Review the Decklist' })
    expect(
      screen.getByRole('button', { name: /Inscribe 0 folios/ }),
    ).toBeDisabled()

    // Picking LEA makes the row ready. "Change" brings the picker back and the
    // count returns to 0.
    await user.click(
      screen.getByRole('button', { name: /Limited Edition Alpha/ }),
    )
    expect(
      await screen.findByRole('button', { name: /Inscribe 1 folio/ }),
    ).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Change' }))
    expect(
      await screen.findByRole('button', { name: /Inscribe 0 folios/ }),
    ).toBeDisabled()
    expect(
      screen.getByRole('list', { name: /Printings of Lightning Bolt/ }),
    ).toBeInTheDocument()
  })

  it('inscribes the ready rows and counts leftover ambiguous as skipped', async () => {
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
      ]),
    )
    resolveMock.mockResolvedValue({
      results: [
        {
          input: inputOf('Sol Ring', 1),
          status: 'matched',
          match: printing({ scryfall_id: 'sol-1', name: 'Sol Ring' }),
          candidates: [],
        },
        {
          input: inputOf('Lightning Bolt', 4),
          status: 'ambiguous',
          match: null,
          candidates: [printing({ scryfall_id: 'lea-bolt' })],
        },
      ],
      summary: { matched: 1, ambiguous: 1, unmatched: 0 },
    })
    inscribeMock.mockResolvedValue({ created: [], count: 1 })

    const user = await resolveText('Sol Ring\n4 Lightning Bolt')

    // Inscribe the matched Sol Ring while the Bolt stays ambiguous.
    await screen.findByText(/1 unresolved line will be skipped/)
    await user.click(
      await screen.findByRole('button', { name: /Inscribe 1 folio/ }),
    )

    // Only the matched row went to the backend.
    await waitFor(() =>
      expect(inscribeMock).toHaveBeenCalledWith([
        {
          scryfall_id: 'sol-1',
          quantity: 1,
          finish: 'nonfoil',
          condition: 'NM',
        },
      ]),
    )
    const summary = await screen.findByText(/Inscribed 1 folio \(1 copy\)/)
    expect(summary.closest('[role="status"]')).toHaveTextContent(
      /1 line skipped/,
    )
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
      'No readable card lines were found. See the problems below.',
    )
    const problems = screen.getByRole('complementary', {
      name: 'Unreadable lines',
    })
    expect(
      within(problems).getByText(/Line 1, quantity with no card name/),
    ).toBeInTheDocument()
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
          input: inputOf('Sol Ring', 1),
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

  it('shows an empty state when no line matched a printing', async () => {
    parseMock.mockResolvedValue(
      parsed([
        {
          line_number: 1,
          name: 'Blak Lotus',
          quantity: 1,
          set_code: null,
          collector_number: null,
        },
        {
          line_number: 2,
          name: 'Sol Rang',
          quantity: 1,
          set_code: null,
          collector_number: null,
        },
      ]),
    )
    resolveMock.mockResolvedValue({
      results: [
        {
          input: inputOf('Blak Lotus', 1),
          status: 'unmatched',
          match: null,
          candidates: [],
        },
        {
          input: inputOf('Sol Rang', 1),
          status: 'unmatched',
          match: null,
          candidates: [],
        },
      ],
      summary: { matched: 0, ambiguous: 0, unmatched: 2 },
    })

    await resolveText('Blak Lotus\nSol Rang')

    expect(
      await screen.findByRole('heading', { name: 'Nothing matched' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/None of the 2 lines matched/)).toBeInTheDocument()
    // Each row still lists, and there is nothing to inscribe.
    expect(screen.getByText(/No printing of .*Sol Rang/)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Inscribe 0 folios/ }),
    ).toBeDisabled()
  })
})
