import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  CardPrinting,
  CsvParseResult,
  CsvRow,
  ResolveResponse,
} from '../api'
import { CsvImportPage } from './CsvImportPage'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return {
    ...actual,
    parseCsv: vi.fn(),
    resolveDecklist: vi.fn(),
    inscribeBulk: vi.fn(),
  }
})

import { inscribeBulk, parseCsv, resolveDecklist } from '../api'

const parseMock = vi.mocked(parseCsv)
const resolveMock = vi.mocked(resolveDecklist)
const inscribeMock = vi.mocked(inscribeBulk)

function printing(overrides: Partial<CardPrinting>): CardPrinting {
  return {
    scryfall_id: 'id',
    name: 'Sol Ring',
    set_code: 'cmd',
    set_name: 'Commander',
    collector_number: '256',
    rarity: 'uncommon',
    finishes: ['nonfoil', 'foil'],
    image_uris: null,
    ...overrides,
  }
}

function csvRow(overrides: Partial<CsvRow>): CsvRow {
  return {
    row_number: 1,
    name: 'Sol Ring',
    quantity: 1,
    set_code: 'cmd',
    set_name: 'Commander',
    collector_number: '256',
    scryfall_id: 'sol-cmd',
    finish: 'nonfoil',
    condition: 'NM',
    language: 'en',
    ...overrides,
  }
}

function parsed(
  entries: CsvRow[],
  problems: CsvParseResult['problems'] = [],
  format: CsvParseResult['format'] = 'manabox',
): CsvParseResult {
  return { format, entries, problems }
}

function inputOf(name: string, quantity: number) {
  return {
    name,
    quantity,
    finish: null,
    condition: null,
    language: null,
  }
}

afterEach(() => vi.clearAllMocks())

/** The ledger's own entries, leaving out the candidate picker's options. */
function entriesOf(list: HTMLElement): HTMLElement[] {
  return Array.from(list.children) as HTMLElement[]
}

async function resolveText(text: string) {
  const user = userEvent.setup()
  render(<CsvImportPage />)
  await user.type(screen.getByLabelText(/paste CSV text/), text)
  await user.click(screen.getByRole('button', { name: 'Resolve CSV' }))
  return user
}

describe('CsvImportPage', () => {
  it('lays the preview out as a ledger with finish and condition in words', async () => {
    parseMock.mockResolvedValue(
      parsed([
        csvRow({
          row_number: 1,
          name: 'Sol Ring',
          quantity: 2,
          finish: 'foil',
          condition: 'LP',
        }),
        csvRow({
          row_number: 2,
          name: 'Arcane Signet',
          finish: 'nonfoil',
          condition: 'NM',
        }),
        csvRow({ row_number: 3, name: 'Lightning Bolt' }),
      ]),
    )
    resolveMock.mockResolvedValue({
      results: [
        {
          input: inputOf('Sol Ring', 2),
          status: 'matched',
          match: printing({ scryfall_id: 'sol-cmd' }),
          candidates: [],
        },
        {
          input: inputOf('Arcane Signet', 1),
          status: 'matched',
          match: printing({
            scryfall_id: 'signet-c21',
            name: 'Arcane Signet',
            set_name: 'Commander 2021',
            collector_number: '236',
          }),
          candidates: [],
        },
        {
          input: inputOf('Lightning Bolt', 1),
          status: 'ambiguous',
          match: null,
          candidates: [
            printing({
              scryfall_id: 'lea-bolt',
              name: 'Lightning Bolt',
              set_name: 'Limited Edition Alpha',
            }),
            printing({
              scryfall_id: 'm10-bolt',
              name: 'Lightning Bolt',
              set_name: 'Magic 2010',
            }),
          ],
        },
      ],
      summary: { matched: 2, ambiguous: 1, unmatched: 0 },
    })

    await resolveText('Name,Quantity\nSol Ring,2')
    await screen.findByRole('heading', { name: 'Review the Import' })

    expect(
      screen.getByText(
        'Detected manabox. Two ready, one to choose, none unmatched.',
      ),
    ).toHaveClass('import__summary')

    const list = screen.getByRole('list', { name: 'Rows' })
    const [sol, signet, bolt] = entriesOf(list)
    expect(entriesOf(list)).toHaveLength(3)

    const solName = sol.querySelector('.ledger__name') as HTMLElement
    expect(solName.firstElementChild).toHaveTextContent('ready')
    expect(solName).toHaveTextContent('ready Sol Ring')
    // The finish and condition join the printing line rather than tags.
    expect(sol).toHaveTextContent('Commander, no. 256, foil, lightly played.')
    expect(sol).toHaveTextContent('2 copies')
    // Nonfoil goes unsaid; the condition is still spelled out.
    expect(signet).toHaveTextContent('Commander 2021, no. 236, near mint.')
    expect(signet).not.toHaveTextContent('nonfoil')

    expect(bolt).toHaveTextContent('Several printings match; choose one below.')
    expect(
      within(bolt).getByRole('list', { name: 'Printings of Lightning Bolt' }),
    ).toBeInTheDocument()
  })

  it('parses, resolves, and inscribes with each row’s own finish/condition', async () => {
    parseMock.mockResolvedValue(
      parsed([
        csvRow({
          row_number: 1,
          name: 'Sol Ring',
          scryfall_id: 'sol-cmd',
          finish: 'foil',
          condition: 'LP',
          language: 'en',
        }),
        csvRow({
          row_number: 2,
          name: 'Black Lotus',
          scryfall_id: 'nope',
          finish: 'nonfoil',
          condition: 'NM',
        }),
      ]),
    )
    const resolveResponse: ResolveResponse = {
      results: [
        {
          input: inputOf('Sol Ring', 1),
          status: 'matched',
          match: printing({ scryfall_id: 'sol-cmd' }),
          candidates: [],
        },
        {
          input: inputOf('Black Lotus', 1),
          status: 'unmatched',
          match: null,
          candidates: [],
        },
      ],
      summary: { matched: 1, ambiguous: 0, unmatched: 1 },
    }
    resolveMock.mockResolvedValue(resolveResponse)
    inscribeMock.mockResolvedValue({ created: [], count: 1 })

    const user = await resolveText('Name,Quantity\nSol Ring,1')

    // Preview shows the detected format and the unmatched row.
    expect(
      await screen.findByRole('heading', { name: 'Review the Import' }),
    ).toBeInTheDocument()
    // The live region mounts empty on the preview step so the summary that
    // later fills it is announced.
    const region = screen.getByRole('status')
    expect(region).toBeEmptyDOMElement()
    expect(screen.getByText(/Detected manabox/)).toBeInTheDocument()
    expect(screen.getByText(/No printing of .*Black Lotus/)).toBeInTheDocument()
    // One row matched, so the empty state stays away.
    expect(screen.queryByText('Nothing matched')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Inscribe 1 folio/ }))

    // The matched row inscribes with its own finish/condition/language.
    await waitFor(() =>
      expect(inscribeMock).toHaveBeenCalledWith([
        {
          scryfall_id: 'sol-cmd',
          quantity: 1,
          finish: 'foil',
          condition: 'LP',
          language: 'en',
        },
      ]),
    )
    const summary = await screen.findByText(/Inscribed 1 folio \(1 copy\)/)
    // The same node that sat empty on the preview step now carries it.
    expect(summary.closest('[role="status"]')).toBe(region)
    expect(summary.closest('[role="status"]')).toHaveTextContent(
      /1 row skipped/,
    )
  })

  it('keeps the finish and condition on rows with no printing yet', async () => {
    parseMock.mockResolvedValue(
      parsed([
        csvRow({
          row_number: 1,
          name: 'Lightning Bolt',
          finish: 'foil',
          condition: 'LP',
        }),
        csvRow({
          row_number: 2,
          name: 'Black Lotus',
          finish: 'nonfoil',
          condition: 'HP',
        }),
        csvRow({
          row_number: 3,
          name: 'Mox Jet',
          finish: 'nonfoil',
          condition: null,
        }),
      ]),
    )
    resolveMock.mockResolvedValue({
      results: [
        {
          input: inputOf('Lightning Bolt', 1),
          status: 'ambiguous',
          match: null,
          candidates: [
            printing({ scryfall_id: 'lea-bolt', name: 'Lightning Bolt' }),
            printing({ scryfall_id: 'm10-bolt', name: 'Lightning Bolt' }),
          ],
        },
        {
          input: inputOf('Black Lotus', 1),
          status: 'unmatched',
          match: null,
          candidates: [],
        },
        {
          input: inputOf('Mox Jet', 1),
          status: 'unmatched',
          match: null,
          candidates: [],
        },
      ],
      summary: { matched: 0, ambiguous: 1, unmatched: 2 },
    })

    await resolveText('Name,Quantity\nLightning Bolt,1')
    const list = await screen.findByRole('list', { name: 'Rows' })
    const [bolt, lotus, mox] = entriesOf(list)
    const whereOf = (entry: HTMLElement) =>
      entry.querySelector('.ledger__where') as HTMLElement

    expect(whereOf(bolt)).toHaveTextContent(
      'Several printings match; choose one below. Foil, lightly played.',
    )
    expect(whereOf(lotus)).toHaveTextContent(
      'No printing of “Black Lotus” resides in the catalog. Heavily played.',
    )
    // Nonfoil with no condition has nothing to add.
    expect(whereOf(mox).textContent).toBe(
      'No printing of “Mox Jet” resides in the catalog.',
    )
  })

  it('surfaces an unrecognized-format error and re-parses after a manual pick', async () => {
    const { ApiError } =
      await vi.importActual<typeof import('../api')>('../api')
    parseMock.mockRejectedValueOnce(
      new ApiError(
        'Could not recognize the CSV format.',
        422,
        'Could not recognize the CSV format.',
      ),
    )

    const user = await resolveText('Foo,Bar\n1,2')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Could not recognize the CSV format/,
    )

    // Pick a format explicitly and retry, and now it parses.
    parseMock.mockResolvedValueOnce(parsed([csvRow({})], [], 'deckbox'))
    resolveMock.mockResolvedValue({
      results: [
        {
          input: inputOf('Sol Ring', 1),
          status: 'matched',
          match: printing({ scryfall_id: 'sol-cmd' }),
          candidates: [],
        },
      ],
      summary: { matched: 1, ambiguous: 0, unmatched: 0 },
    })
    await user.selectOptions(screen.getByLabelText('Source format'), 'deckbox')
    await user.click(screen.getByRole('button', { name: 'Resolve CSV' }))

    expect(
      await screen.findByRole('heading', { name: 'Review the Import' }),
    ).toBeInTheDocument()
    // The override format was sent on the retry.
    expect(parseMock).toHaveBeenLastCalledWith('Foo,Bar\n1,2', 'deckbox')
  })

  it('disambiguates an ambiguous row and inscribes the chosen printing', async () => {
    parseMock.mockResolvedValue(
      parsed([
        csvRow({ name: 'Lightning Bolt', finish: 'nonfoil', condition: 'NM' }),
      ]),
    )
    resolveMock.mockResolvedValue({
      results: [
        {
          input: inputOf('Lightning Bolt', 1),
          status: 'ambiguous',
          match: null,
          candidates: [
            printing({
              scryfall_id: 'lea-bolt',
              name: 'Lightning Bolt',
              set_name: 'Limited Edition Alpha',
            }),
            printing({
              scryfall_id: 'm10-bolt',
              name: 'Lightning Bolt',
              set_name: 'Magic 2010',
              set_code: 'm10',
            }),
          ],
        },
      ],
      summary: { matched: 0, ambiguous: 1, unmatched: 0 },
    })
    inscribeMock.mockResolvedValue({ created: [], count: 1 })

    const user = await resolveText('Name,Quantity\nLightning Bolt,1')

    // Nothing chosen yet, so Inscribe is disabled.
    await screen.findByRole('heading', { name: 'Review the Import' })
    expect(
      screen.getByRole('button', { name: /Inscribe 0 folios/ }),
    ).toBeDisabled()

    // Picking the M10 printing makes the row ready, and it inscribes that id.
    await user.click(screen.getByRole('button', { name: /Magic 2010/ }))
    await user.click(
      await screen.findByRole('button', { name: /Inscribe 1 folio/ }),
    )
    await waitFor(() =>
      expect(inscribeMock).toHaveBeenCalledWith([
        {
          scryfall_id: 'm10-bolt',
          quantity: 1,
          finish: 'nonfoil',
          condition: 'NM',
          language: 'en',
        },
      ]),
    )
  })

  it('writes the chosen printing into the where line and takes it back on Change', async () => {
    parseMock.mockResolvedValue(
      parsed([
        csvRow({ name: 'Lightning Bolt', finish: 'foil', condition: 'LP' }),
      ]),
    )
    resolveMock.mockResolvedValue({
      results: [
        {
          input: inputOf('Lightning Bolt', 1),
          status: 'ambiguous',
          match: null,
          candidates: [
            printing({
              scryfall_id: 'lea-bolt',
              name: 'Lightning Bolt',
              set_name: 'Limited Edition Alpha',
            }),
            printing({
              scryfall_id: 'm10-bolt',
              name: 'Lightning Bolt',
              set_name: 'Magic 2010',
              set_code: 'm10',
            }),
          ],
        },
      ],
      summary: { matched: 0, ambiguous: 1, unmatched: 0 },
    })

    const user = await resolveText('Name,Quantity\nLightning Bolt,1')
    const list = await screen.findByRole('list', { name: 'Rows' })
    const [bolt] = entriesOf(list)
    const where = () => bolt.querySelector('.ledger__where') as HTMLElement

    await user.click(within(bolt).getByRole('button', { name: /Magic 2010/ }))
    expect(where()).toHaveTextContent(
      'Magic 2010, no. 256, foil, lightly played.',
    )
    expect(
      within(bolt).queryByRole('button', { name: /Magic 2010/ }),
    ).not.toBeInTheDocument()

    await user.click(within(bolt).getByRole('button', { name: 'Change' }))
    expect(
      within(bolt).getByRole('button', { name: /Magic 2010/ }),
    ).toBeInTheDocument()
    expect(where()).toHaveTextContent(
      'Several printings match; choose one below. Foil, lightly played.',
    )
  })

  it('sets a thumb only on rows with a chosen printing', async () => {
    parseMock.mockResolvedValue(
      parsed([
        csvRow({ row_number: 1, name: 'Sol Ring' }),
        csvRow({ row_number: 2, name: 'Black Lotus' }),
        csvRow({ row_number: 3, name: 'Lightning Bolt' }),
      ]),
    )
    resolveMock.mockResolvedValue({
      results: [
        {
          input: inputOf('Sol Ring', 1),
          status: 'matched',
          match: printing({ scryfall_id: 'sol-cmd' }),
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
            printing({ scryfall_id: 'lea-bolt', name: 'Lightning Bolt' }),
            printing({ scryfall_id: 'm10-bolt', name: 'Lightning Bolt' }),
          ],
        },
      ],
      summary: { matched: 1, ambiguous: 1, unmatched: 1 },
    })

    await resolveText('Name,Quantity\nSol Ring,1')
    const list = await screen.findByRole('list', { name: 'Rows' })
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

  it('populates the textarea from an uploaded file', async () => {
    const user = userEvent.setup()
    parseMock.mockResolvedValue(parsed([csvRow({})]))
    resolveMock.mockResolvedValue({
      results: [
        {
          input: inputOf('Sol Ring', 1),
          status: 'matched',
          match: printing({ scryfall_id: 'sol-cmd' }),
          candidates: [],
        },
      ],
      summary: { matched: 1, ambiguous: 0, unmatched: 0 },
    })
    render(<CsvImportPage />)

    const csv = 'Name,Quantity\nSol Ring,1'
    const file = new File([csv], 'collection.csv', { type: 'text/csv' })
    // jsdom doesn't implement Blob.text() reliably; stub it for handleFile.
    Object.defineProperty(file, 'text', { value: () => Promise.resolve(csv) })
    await user.upload(screen.getByLabelText('CSV file'), file)
    // The file contents land in the textarea (async read), ready to resolve.
    await waitFor(() =>
      expect(screen.getByLabelText(/paste CSV text/)).toHaveValue(
        'Name,Quantity\nSol Ring,1',
      ),
    )
    await user.click(screen.getByRole('button', { name: 'Resolve CSV' }))
    expect(
      await screen.findByRole('heading', { name: 'Review the Import' }),
    ).toBeInTheDocument()
  })

  it('guards against a resolve result/entry length mismatch', async () => {
    parseMock.mockResolvedValue(
      parsed([csvRow({}), csvRow({ name: 'Mana Crypt' })]),
    )
    // Backend returns fewer results than entries; must not mis-zip or crash.
    resolveMock.mockResolvedValue({
      results: [
        {
          input: inputOf('Sol Ring', 1),
          status: 'matched',
          match: printing({ scryfall_id: 'sol-cmd' }),
          candidates: [],
        },
      ],
      summary: { matched: 1, ambiguous: 0, unmatched: 0 },
    })
    await resolveText('Name,Quantity\nSol Ring,1\nMana Crypt,1')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /returned 1 results for 2 rows/,
    )
    expect(inscribeMock).not.toHaveBeenCalled()
  })

  it('reports unreadable rows when nothing parses', async () => {
    parseMock.mockResolvedValue(
      parsed(
        [],
        [{ row_number: 1, text: ',cmd,...', reason: 'missing card name' }],
      ),
    )
    await resolveText('Name,Quantity\n,1')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No readable rows were found. See the problems below.',
    )
    const problems = screen.getByRole('complementary', {
      name: 'Unreadable rows',
    })
    expect(
      within(problems).getByText(/Row 1, missing card name/),
    ).toBeInTheDocument()
    expect(resolveMock).not.toHaveBeenCalled()
  })

  it('shows an empty state when no row matched a printing', async () => {
    parseMock.mockResolvedValue(
      parsed([csvRow({ row_number: 1, name: 'Blak Lotus', scryfall_id: 'x' })]),
    )
    resolveMock.mockResolvedValue({
      results: [
        {
          input: inputOf('Blak Lotus', 1),
          status: 'unmatched',
          match: null,
          candidates: [],
        },
      ],
      summary: { matched: 0, ambiguous: 0, unmatched: 1 },
    })

    await resolveText('Name,Quantity\nBlak Lotus,1')

    expect(
      await screen.findByRole('heading', { name: 'Nothing matched' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/None of the 1 row matched/)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Inscribe 0 folios/ }),
    ).toBeDisabled()
  })
})
