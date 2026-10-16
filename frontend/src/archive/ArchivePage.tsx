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
  Notice,
  PageHeader,
  Panel,
  Sealed,
  Tag,
} from '../components'
import { archiveKeys } from './queryKeys'
import './archive.css'

const REASON_LABELS: Record<BackupReason, string> = {
  manual: 'By hand',
  premigration: 'Before migration',
  startup: 'Daily',
}

/** Decimal megabytes, as Finder and most file managers count them. */
function megabytes(bytes: number): string {
  const mb = bytes / 1_000_000
  return mb < 0.05 ? '< 0.1 MB' : `${mb.toFixed(1)} MB`
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
      <PageHeader eyebrow="Safekeeping" title="The Muniment Room" />

      <Panel
        as="section"
        className="archive__panel"
        aria-labelledby={copiesHeading}
      >
        <h2 id={copiesHeading}>Sealed copies</h2>
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
          <div className="archive__scroll">
            <table className="archive__table" aria-label="Backups">
              <thead>
                <tr>
                  <th scope="col">Sealed</th>
                  <th scope="col">Reason</th>
                  <th scope="col">Schema</th>
                  <th scope="col">Size</th>
                </tr>
              </thead>
              <tbody>
                {query.data.backups.map((copy) => (
                  <tr key={copy.filename}>
                    <td>{new Date(copy.created_at).toLocaleString()}</td>
                    <td>
                      <Tag>{REASON_LABELS[copy.reason]}</Tag>
                    </td>
                    <td>v{copy.schema_version}</td>
                    <td>{megabytes(copy.size_bytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {query.data !== undefined && (
          <p className="archive__note archive__wrap">
            Copies rest in {query.data.directory}. The newest {query.data.keep}{' '}
            sealed by hand are kept, the newest {query.data.premigration_keep}{' '}
            sealed before a migration, and the newest {query.data.startup_keep}{' '}
            daily copies. To restore one, follow the README.
          </p>
        )}
      </Panel>

      <Panel
        as="section"
        className="archive__panel"
        aria-labelledby={exportsHeading}
      >
        <h2 id={exportsHeading}>Carry the collection elsewhere</h2>
        <ul className="archive__exports">
          <li>
            <a href={EXPORT_CSV_URL} download>
              Export the collection as CSV
            </a>
          </li>
          <li>
            <a href={EXPORT_JSON_URL} download>
              Export the collection as JSON
            </a>
          </li>
        </ul>
        <p className="archive__note">
          The CSV reads back through the CSV import, though location, notes,
          tags, acquisition date and price are not imported yet. The JSON
          carries every folio and every Tome.
        </p>
      </Panel>
    </section>
  )
}
