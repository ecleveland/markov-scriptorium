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

async function resolveText(text: string) {
  const user = userEvent.setup()
  render(<CsvImportPage />)
  await user.type(screen.getByLabelText(/paste CSV text/), text)
  await user.click(screen.getByRole('button', { name: 'Resolve CSV' }))
  return user
}

describe('CsvImportPage', () => {
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
    expect(screen.getByText(/Detected manabox/)).toBeInTheDocument()
    expect(screen.getByText(/No printing of .*Black Lotus/)).toBeInTheDocument()

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
    const summary = await screen.findByRole('status')
    expect(summary).toHaveTextContent(/Inscribed 1 folio \(1 copy\)/)
    expect(summary).toHaveTextContent(/1 row skipped/)
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

    // Pick a format explicitly and retry — now it parses.
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

  it('reports unreadable rows when nothing parses', async () => {
    parseMock.mockResolvedValue(
      parsed(
        [],
        [{ row_number: 1, text: ',cmd,...', reason: 'missing card name' }],
      ),
    )
    await resolveText('Name,Quantity\n,1')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /No readable rows/,
    )
    const problems = screen.getByRole('complementary', {
      name: 'Unreadable rows',
    })
    expect(within(problems).getByText(/Row 1:/)).toBeInTheDocument()
    expect(resolveMock).not.toHaveBeenCalled()
  })
})
