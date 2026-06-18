import { useState } from 'react'
import {
  ApiError,
  CSV_SOURCES,
  inscribeBulk,
  parseCsv,
  resolveDecklist,
  type CardPrinting,
  type Condition,
  type CsvProblem,
  type CsvRow,
  type CsvSource,
  type Finish,
} from '../api'
import { CandidatePicker } from './CandidatePicker'
import './decklist.css'

/** A parsed CSV row paired with how it resolved. Same three-state union as the
 *  decklist flow, but the entry carries its own finish/condition/language. */
type PreviewRow =
  | { entry: CsvRow; status: 'matched'; chosen: CardPrinting }
  | {
      entry: CsvRow
      status: 'ambiguous'
      candidates: CardPrinting[]
      chosen: CardPrinting | null
    }
  | { entry: CsvRow; status: 'unmatched'; chosen: null }

type Step = 'upload' | 'preview' | 'summary'

function describe(printing: CardPrinting): string {
  return `${printing.set_name} (${printing.set_code.toUpperCase()}) · #${printing.collector_number}`
}

function errorMessage(err: unknown): string {
  if (err instanceof ApiError && err.detail) return err.detail
  return 'The scriptorium could not be reached. Please try again.'
}

/** The per-row problems, shown on both the upload and preview steps. */
function UnreadableRows({ problems }: { problems: CsvProblem[] }) {
  if (problems.length === 0) return null
  return (
    <aside className="decklist__problems" aria-label="Unreadable rows">
      <h2>Unreadable rows</h2>
      <ul>
        {problems.map((problem) => (
          <li key={problem.row_number}>
            Row {problem.row_number}: {problem.reason} — “{problem.text}”
          </li>
        ))}
      </ul>
    </aside>
  )
}

/**
 * Import a collection CSV (Manabox / Deckbox / Archidekt): upload or paste →
 * detect the source (overridable) → resolve every row against the catalog →
 * disambiguate the rows that matched several printings → inscribe in one atomic
 * batch. Unlike the decklist flow, each row carries its own finish/condition/
 * language, so there is no batch selector. Unmatched/unreadable rows are
 * reported in the summary, never dropped (VEG-415).
 */
export function CsvImportPage() {
  const [step, setStep] = useState<Step>('upload')
  const [text, setText] = useState('')
  const [format, setFormat] = useState<CsvSource | 'auto'>('auto')
  const [detected, setDetected] = useState<CsvSource | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [problems, setProblems] = useState<CsvProblem[]>([])
  const [rows, setRows] = useState<PreviewRow[]>([])
  const [summary, setSummary] = useState<{
    lots: number
    copies: number
    skipped: number
  } | null>(null)

  const readyRows = rows.filter(
    (row): row is PreviewRow & { chosen: CardPrinting } => row.chosen !== null,
  )
  const unresolvedCount = rows.filter(
    (row) => row.status === 'ambiguous' && !row.chosen,
  ).length
  const unmatchedCount = rows.filter((row) => row.status === 'unmatched').length

  async function handleFile(file: File | undefined) {
    if (!file) return
    setText(await file.text())
  }

  async function handleResolve() {
    setBusy(true)
    setError(null)
    try {
      const parsed = await parseCsv(
        text,
        format === 'auto' ? undefined : format,
      )
      setDetected(parsed.format)
      setProblems(parsed.problems)
      if (parsed.entries.length === 0) {
        setError(
          parsed.problems.length > 0
            ? 'No readable rows were found — see the problems below.'
            : 'Upload or paste a CSV to begin.',
        )
        return
      }
      const resolved = await resolveDecklist(
        parsed.entries.map((entry) => ({
          name: entry.name,
          set_code: entry.set_code,
          set_name: entry.set_name,
          collector_number: entry.collector_number,
          scryfall_id: entry.scryfall_id,
          quantity: entry.quantity,
        })),
      )
      if (resolved.results.length !== parsed.entries.length) {
        setError(
          `The catalog returned ${resolved.results.length} results for ${parsed.entries.length} rows; nothing was imported.`,
        )
        return
      }
      setRows(
        parsed.entries.map((entry, index): PreviewRow => {
          const result = resolved.results[index]
          if (result.status === 'ambiguous') {
            return {
              entry,
              status: 'ambiguous',
              candidates: result.candidates,
              chosen: null,
            }
          }
          if (result.status === 'matched' && result.match) {
            return { entry, status: 'matched', chosen: result.match }
          }
          return { entry, status: 'unmatched', chosen: null }
        }),
      )
      setStep('preview')
    } catch (err) {
      console.error('Resolving the CSV failed', err)
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  function choose(index: number, printing: CardPrinting | null) {
    setRows((prev) =>
      prev.map((row, i) =>
        i === index && row.status === 'ambiguous'
          ? { ...row, chosen: printing }
          : row,
      ),
    )
  }

  async function handleInscribe() {
    setBusy(true)
    setError(null)
    try {
      const response = await inscribeBulk(
        readyRows.map((row) => ({
          scryfall_id: row.chosen.scryfall_id,
          quantity: row.entry.quantity,
          // The backend normalized these to valid enums, or the row would be a
          // problem and never reach the preview.
          finish: (row.entry.finish ?? 'nonfoil') as Finish,
          condition: (row.entry.condition ?? 'NM') as Condition,
          language: row.entry.language ?? undefined,
        })),
      )
      const copies = readyRows.reduce((sum, row) => sum + row.entry.quantity, 0)
      setSummary({
        lots: response.count,
        copies,
        skipped: rows.length - readyRows.length + problems.length,
      })
      setStep('summary')
    } catch (err) {
      console.error('Bulk inscribe failed', err)
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  function reset() {
    setStep('upload')
    setText('')
    setRows([])
    setProblems([])
    setSummary(null)
    setError(null)
    setDetected(null)
  }

  if (step === 'summary' && summary) {
    return (
      <section className="decklist">
        <h1>Collection Inscribed</h1>
        <p className="decklist__summary" role="status">
          Inscribed {summary.lots} {summary.lots === 1 ? 'folio' : 'folios'} (
          {summary.copies} {summary.copies === 1 ? 'copy' : 'copies'}) into the
          catalog.
          {summary.skipped > 0 &&
            ` ${summary.skipped} row${summary.skipped === 1 ? '' : 's'} skipped.`}
        </p>
        <button type="button" onClick={reset}>
          Import another CSV
        </button>
      </section>
    )
  }

  if (step === 'preview') {
    return (
      <section className="decklist">
        <header className="decklist__header">
          <h1>Review the Import</h1>
          <button type="button" onClick={() => setStep('upload')}>
            Back to upload
          </button>
        </header>

        <p className="decklist__counts">
          {detected && <>Detected {detected}. </>}
          {readyRows.length} ready · {unresolvedCount} to choose ·{' '}
          {unmatchedCount} unmatched
          {problems.length > 0 && ` · ${problems.length} unreadable`}
        </p>

        <ol className="decklist__rows">
          {rows.map((row, index) => (
            <li
              key={index}
              className={`decklist__row decklist__row--${row.status}`}
            >
              <span className="decklist__line">
                {row.entry.quantity}× {row.entry.name}
                {row.entry.finish && row.entry.finish !== 'nonfoil' && (
                  <> · {row.entry.finish}</>
                )}{' '}
                · {row.entry.condition}
              </span>
              {row.chosen ? (
                <span className="decklist__chosen">
                  {describe(row.chosen)}
                  {row.status === 'ambiguous' && (
                    <button type="button" onClick={() => choose(index, null)}>
                      Change
                    </button>
                  )}
                </span>
              ) : row.status === 'ambiguous' ? (
                <CandidatePicker
                  name={row.entry.name}
                  candidates={row.candidates}
                  selectedId={null}
                  onPick={(printing) => choose(index, printing)}
                />
              ) : (
                <span className="decklist__unmatched">
                  No printing of “{row.entry.name}” resides in the catalog.
                </span>
              )}
            </li>
          ))}
        </ol>

        <UnreadableRows problems={problems} />

        {error && <p role="alert">{error}</p>}

        <button
          type="button"
          onClick={handleInscribe}
          disabled={busy || readyRows.length === 0}
        >
          {busy
            ? 'Inscribing…'
            : `Inscribe ${readyRows.length} ${readyRows.length === 1 ? 'folio' : 'folios'}`}
        </button>
        {unresolvedCount + unmatchedCount > 0 && readyRows.length > 0 && (
          <p className="decklist__skip-note">
            {unresolvedCount + unmatchedCount} unresolved row
            {unresolvedCount + unmatchedCount === 1 ? '' : 's'} will be skipped.
          </p>
        )}
      </section>
    )
  }

  return (
    <section className="decklist">
      <h1>Import a Collection CSV</h1>
      <p>
        Upload a CSV exported from Manabox, Deckbox, or Archidekt. The source is
        detected from its columns; finish, condition, and language come from the
        file.
      </p>

      <div className="decklist__finish">
        <label>
          CSV file
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => handleFile(event.target.files?.[0])}
          />
        </label>
        <label>
          Source format
          <select
            value={format}
            onChange={(event) =>
              setFormat(event.target.value as CsvSource | 'auto')
            }
          >
            <option value="auto">Auto-detect</option>
            {CSV_SOURCES.map((source) => (
              <option key={source} value={source}>
                {source}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="decklist__input">
        <span className="decklist__input-label">…or paste CSV text</span>
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={10}
          placeholder={
            'Name,Set code,Collector number,Foil,Quantity,Scryfall ID,Condition,Language'
          }
        />
      </label>

      <UnreadableRows problems={problems} />

      {error && <p role="alert">{error}</p>}

      <button
        type="button"
        onClick={handleResolve}
        disabled={busy || text.trim().length === 0}
      >
        {busy ? 'Consulting the catalog…' : 'Resolve CSV'}
      </button>
    </section>
  )
}
