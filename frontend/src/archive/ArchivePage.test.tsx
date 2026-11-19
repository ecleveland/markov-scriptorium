import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { backup } from '../test/fixtures'
import { renderWithQuery } from '../test/queryWrapper'
import { ArchivePage } from './ArchivePage'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return { ...actual, listBackups: vi.fn(), createBackup: vi.fn() }
})

import { ApiError, createBackup, listBackups, type Backup } from '../api'

const listMock = vi.mocked(listBackups)
const createMock = vi.mocked(createBackup)

function backupList(backups: Backup[]) {
  return {
    directory: '/tmp/scriptorium/backups',
    keep: 3,
    premigration_keep: 2,
    daily_keep: 7,
    backups,
  }
}

afterEach(() => vi.clearAllMocks())

describe('ArchivePage', () => {
  it('names the room and consults the muniments while the list loads', () => {
    listMock.mockReturnValue(new Promise(() => {}))
    renderWithQuery(<ArchivePage />)

    expect(
      screen.getByRole('heading', { level: 1, name: 'The Muniment Room' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Consulting the muniments…')).toBeInTheDocument()
  })

  it('explains a list that could not be read', async () => {
    listMock.mockRejectedValue(new ApiError('The vault is locked.', 500))
    renderWithQuery(<ArchivePage />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The sealed copies could not be read.',
    )
  })

  it('says so when no copy is sealed yet', async () => {
    listMock.mockResolvedValue(backupList([]))
    renderWithQuery(<ArchivePage />)

    expect(
      await screen.findByRole('heading', { name: 'No copies sealed yet' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        "Seal one above. The scriptorium also seals a copy on its own before any change to the catalog's shape.",
      ),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('list', { name: 'Sealed copies' }),
    ).not.toBeInTheDocument()
  })

  it('lists each copy with when, why, schema, and size, and where they rest', async () => {
    const byHand = backup({
      created_at: '2026-10-15T14:22:33Z',
      size_bytes: 2_400_000,
    })
    const premigration = backup({
      filename: 'scriptorium-20261001T080000Z-v5-premigration.db',
      reason: 'premigration',
      created_at: '2026-10-01T08:00:00Z',
      schema_version: 5,
      size_bytes: 30_000,
    })
    const daily = backup({
      filename: 'scriptorium-20260930T060000Z-v5-daily.db',
      reason: 'daily',
      created_at: '2026-09-30T06:00:00Z',
      schema_version: 5,
    })
    listMock.mockResolvedValue(backupList([byHand, premigration, daily]))
    renderWithQuery(<ArchivePage />)

    const ledger = await screen.findByRole('list', { name: 'Sealed copies' })
    const items = within(ledger).getAllByRole('listitem')
    expect(items).toHaveLength(3)
    const [first, second, third] = items

    expect(first).toHaveTextContent(
      new Date('2026-10-15T14:22:33Z').toLocaleString(),
    )
    expect(within(first).getByText('By hand')).toHaveClass('tag')
    expect(first).toHaveTextContent('By hand schema v6')
    expect(within(first).getByText('2.4')).toHaveClass('ledger__figure')
    expect(within(first).getByText('MB')).toHaveClass('ledger__note')

    expect(within(second).getByText('Before migration')).toHaveClass('tag')
    expect(second).toHaveTextContent('schema v5')
    expect(within(second).getByText('< 0.1')).toHaveClass('ledger__figure')
    expect(within(second).getByText('MB')).toHaveClass('ledger__note')

    expect(within(third).getByText('Daily')).toHaveClass('tag')

    expect(
      screen.getByText(
        'Copies rest in /tmp/scriptorium/backups. The newest 3 sealed by hand are kept, the newest 2 sealed before a migration, and the newest 7 daily copies. To restore one, follow the README.',
      ),
    ).toBeInTheDocument()
  })

  it('reads every retention count from the list, not from the page', async () => {
    listMock.mockResolvedValue({
      ...backupList([backup()]),
      keep: 7,
      premigration_keep: 5,
      daily_keep: 9,
    })
    renderWithQuery(<ArchivePage />)

    expect(
      await screen.findByText(
        /The newest 7 sealed by hand are kept, the newest 5 sealed before a migration, and the newest 9 daily copies\./,
      ),
    ).toBeInTheDocument()
  })

  it('rounds a copy just over the threshold to a tenth of a megabyte', async () => {
    listMock.mockResolvedValue(backupList([backup({ size_bytes: 100_000 })]))
    renderWithQuery(<ArchivePage />)

    const ledger = await screen.findByRole('list', { name: 'Sealed copies' })
    const [entry] = within(ledger).getAllByRole('listitem')
    expect(within(entry).getByText('0.1')).toHaveClass('ledger__figure')
    expect(within(entry).getByText('MB')).toHaveClass('ledger__note')
  })

  it('seals a copy, confirms it by filename, and reads the list again', async () => {
    const user = userEvent.setup()
    const sealed = backup()
    listMock
      .mockResolvedValueOnce(backupList([]))
      .mockResolvedValue(backupList([sealed]))
    let finish: (value: Backup) => void = () => {}
    createMock.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    renderWithQuery(<ArchivePage />)
    await screen.findByRole('heading', { name: 'No copies sealed yet' })

    await user.click(screen.getByRole('button', { name: 'Seal a copy' }))

    expect(createMock).toHaveBeenCalledTimes(1)
    const pending = await screen.findByRole('button', { name: 'Sealing…' })
    expect(pending).toBeDisabled()

    finish(sealed)

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Sealed scriptorium-20261015T142233Z-v6-manual.db.',
    )
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2))
    expect(
      await screen.findByRole('list', { name: 'Sealed copies' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Seal a copy' })).toBeEnabled()
  })

  it('shows why a seal was refused', async () => {
    const user = userEvent.setup()
    const refusal =
      'The scribes are still transcribing the catalog. Seal a copy once the refresh completes.'
    listMock.mockResolvedValue(backupList([]))
    createMock.mockRejectedValue(new ApiError(refusal, 409, refusal))
    renderWithQuery(<ArchivePage />)
    await screen.findByRole('heading', { name: 'No copies sealed yet' })

    await user.click(screen.getByRole('button', { name: 'Seal a copy' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(refusal)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('opens each section with a heading', async () => {
    listMock.mockResolvedValue(backupList([]))
    renderWithQuery(<ArchivePage />)

    expect(
      screen.getByRole('heading', { level: 2, name: 'Sealed copies' }),
    ).toHaveClass('opening')
    expect(
      screen.getByRole('heading', {
        level: 2,
        name: 'Carry the collection elsewhere',
      }),
    ).toHaveClass('opening')
  })

  it('offers both exports as downloads, each in a sentence', async () => {
    listMock.mockResolvedValue(backupList([]))
    renderWithQuery(<ArchivePage />)

    const csv = screen.getByRole('link', { name: 'The collection as CSV' })
    expect(csv).toHaveAttribute('href', '/api/archive/export.csv')
    expect(csv).toHaveAttribute('download')
    expect(csv.closest('p')).toHaveTextContent(
      'The collection as CSV, which reads back through the CSV import, though location, notes, tags, acquisition date and price are not imported yet.',
    )

    const json = screen.getByRole('link', { name: 'The collection as JSON' })
    expect(json).toHaveAttribute('href', '/api/archive/export.json')
    expect(json).toHaveAttribute('download')
    expect(json.closest('p')).toHaveTextContent(
      'The collection as JSON, carrying every folio and every Tome.',
    )
  })
})
