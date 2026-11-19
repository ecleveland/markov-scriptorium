import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId } from 'react'
import {
  EXPORT_CSV_URL,
  EXPORT_JSON_URL,
  createBackup,
  listBackups,
  type BackupReason,
} from '../api'
import {
  Button,
  Consulting,
  EmptyState,
  Ledger,
  LedgerEntry,
  LedgerFigure,
  Notice,
  PageHeader,
  Seal,
  Sealed,
  Tag,
} from '../components'
import { archiveKeys } from './queryKeys'
import './archive.css'

const REASON_LABELS: Record<BackupReason, string> = {
  manual: 'By hand',
  premigration: 'Before migration',
  daily: 'Daily',
}

/**
 * Decimal megabytes, as Finder and most file managers count them. The figure
 * and the unit come apart so the ledger can set the unit beneath the figure.
 */
function megabytes(bytes: number): { figure: string; unit: string } {
  const mb = bytes / 1_000_000
  return { figure: mb < 0.05 ? '< 0.1' : mb.toFixed(1), unit: 'MB' }
}

/** Seal a copy of the database by hand, list the copies, and export the collection. */
export function ArchivePage() {
  const queryClient = useQueryClient()
  const copiesHeading = useId()
  const exportsHeading = useId()
  const query = useQuery({
    queryKey: archiveKeys.backups(),
    queryFn: listBackups,
  })
  const seal = useMutation({
    mutationFn: createBackup,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: archiveKeys.backups() }),
  })

  return (
    <section className="archive">
      <PageHeader
        title={
          <>
            The <span className="rubric">Muniment</span> Room
          </>
        }
      />

      <section className="archive__section" aria-labelledby={copiesHeading}>
        <h2 className="opening" id={copiesHeading}>
          Sealed copies
        </h2>
        <div className="archive__actions">
          <Button
            variant="primary"
            disabled={seal.isPending}
            onClick={() => seal.mutate()}
          >
            {seal.isPending ? 'Sealing…' : 'Seal a copy'}
          </Button>
        </div>
        {seal.isSuccess && (
          <div role="status">
            <Sealed title="Kept in the Muniment Room" className="archive__wrap">
              Sealed {seal.data.filename}.
            </Sealed>
          </div>
        )}
        {seal.isError && (
          <Notice tone="danger" role="alert">
            {seal.error.message}
          </Notice>
        )}

        {query.isPending && <Consulting>Consulting the muniments…</Consulting>}
        {query.isError && (
          <Notice tone="danger" role="alert">
            The sealed copies could not be read.
          </Notice>
        )}
        {query.data !== undefined && query.data.backups.length === 0 && (
          <EmptyState title="No copies sealed yet">
            Seal one above. The scriptorium also seals a copy on its own before
            any change to the catalog's shape.
          </EmptyState>
        )}
        {query.data !== undefined && query.data.backups.length > 0 && (
          <Ledger aria-label="Sealed copies">
            {query.data.backups.map((copy, index) => {
              const size = megabytes(copy.size_bytes)
              return (
                <LedgerEntry
                  key={copy.filename}
                  number={index + 1}
                  thumb={<Seal className="archive__seal" />}
                  name={
                    <span>{new Date(copy.created_at).toLocaleString()}</span>
                  }
                  where={
                    <>
                      <Tag>{REASON_LABELS[copy.reason]}</Tag> schema v
                      {copy.schema_version}
                    </>
                  }
                  count={<LedgerFigure>{size.figure}</LedgerFigure>}
                  note={size.unit}
                />
              )
            })}
          </Ledger>
        )}
        {query.data !== undefined && (
          <p className="archive__note archive__wrap">
            Copies rest in {query.data.directory}. The newest {query.data.keep}{' '}
            sealed by hand are kept, the newest {query.data.premigration_keep}{' '}
            sealed before a migration, and the newest {query.data.daily_keep}{' '}
            daily copies. To restore one, follow the README.
          </p>
        )}
      </section>

      <section className="archive__section" aria-labelledby={exportsHeading}>
        <h2 className="opening" id={exportsHeading}>
          Carry the collection elsewhere
        </h2>
        <p className="archive__export">
          <a href={EXPORT_CSV_URL} download>
            The collection as CSV
          </a>
          , which reads back through the CSV import, though location, notes,
          tags, acquisition date and price are not imported yet.
        </p>
        <p className="archive__export">
          <a href={EXPORT_JSON_URL} download>
            The collection as JSON
          </a>
          , carrying every folio and every Tome.
        </p>
      </section>
    </section>
  )
}
