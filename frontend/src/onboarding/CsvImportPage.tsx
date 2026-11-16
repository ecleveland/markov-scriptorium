import { useState } from 'react'
import {
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
import { capitalised, conditionWords, printingLine } from '../catalog/prose'
import {
  Button,
  CardThumb,
  EmptyState,
  Field,
  Ledger,
  LedgerEntry,
  LedgerFigure,
  Notice,
  PageHeader,
  Sealed,
  Select,
  Textarea,
} from '../components'
import { CandidatePicker } from './CandidatePicker'
import { errorMessage } from './errorMessage'
import { RowStatusTag } from './RowStatusTag'
import { importSummary } from './summary'
import { UnreadableProblems } from './UnreadableProblems'
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

/** The per-row problems, shown on both the upload and preview steps. */
function UnreadableRows({ problems }: { problems: CsvProblem[] }) {
  return (
    <UnreadableProblems
      label="Unreadable rows"
      noun="Row"
      problems={problems.map((problem) => ({
        number: problem.row_number,
        reason: problem.reason,
        text: problem.text,
      }))}
    />
  )
}

/**
 * The row's own finish and condition in words: ["foil", "lightly played"].
 * Nonfoil is the default and goes unsaid, as it does across the Index.
 */
function rowDetails(entry: CsvRow): string[] {
  const words: string[] = []
  if (entry.finish && entry.finish !== 'nonfoil') words.push(entry.finish)
  if (entry.condition) words.push(conditionWords(entry.condition))
  return words
}

/** The chosen printing with the row's details: "Commander, no. 256, foil." */
function chosenLine(entry: CsvRow, chosen: CardPrinting): string {
  return `${[printingLine(chosen), ...rowDetails(entry)].join(', ')}.`
}

/**
 * The row's details as a sentence of their own after a row with no printing
 * yet, " Foil, lightly played.", since they are what will be inscribed once
 * one is chosen. Empty when the row has neither.
 */
function detailsSentence(entry: CsvRow): string {
  const words = rowDetails(entry)
  return words.length === 0 ? '' : ` ${capitalised(words.join(', '))}.`
}

/**
 * Import a collection CSV (Manabox / Deckbox / Archidekt): upload or paste,
 * detect the source (overridable), resolve every row against the catalog,
 * disambiguate the rows that matched several printings, then inscribe in one
 * atomic batch. Unlike the decklist flow, each row carries its own finish/
 * condition/language, so there is no batch selector. Unmatched/unreadable rows
 * are reported in the summary, never dropped (VEG-415).
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
  // Every row resolved and none found a printing: say so once, above the list.
  const nothingMatched =
    rows.length > 0 && readyRows.length === 0 && unresolvedCount === 0

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
            ? 'No readable rows were found. See the problems below.'
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
        <PageHeader title="Collection Inscribed" />
        {/* Second child of the section, as on the preview step, so React
            keeps this node across the transition and the summary is read. */}
        <div role="status">
          <Sealed>
            Inscribed {summary.lots} {summary.lots === 1 ? 'folio' : 'folios'} (
            {summary.copies} {summary.copies === 1 ? 'copy' : 'copies'}) into
            the catalog.
            {summary.skipped > 0 &&
              ` ${summary.skipped} row${summary.skipped === 1 ? '' : 's'} skipped.`}
          </Sealed>
        </div>
        <Button onClick={reset}>Import another CSV</Button>
      </section>
    )
  }

  if (step === 'preview') {
    return (
      <section className="decklist">
        <PageHeader title="Review the Import">
          <Button onClick={() => setStep('upload')}>Back to upload</Button>
        </PageHeader>

        {/* Empty until the import lands. It sits where the summary step puts
            its region, so the same live node is already in the tree when the
            summary text arrives. */}
        <div role="status" />

        <p className="import__summary">
          {importSummary({
            ready: readyRows.length,
            toChoose: unresolvedCount,
            unmatched: unmatchedCount,
            unreadable: problems.length,
            detected: detected ?? undefined,
          })}
        </p>

        {nothingMatched && (
          <EmptyState title="Nothing matched">
            None of the {rows.length} {rows.length === 1 ? 'row' : 'rows'}{' '}
            matched a printing in the catalog. Check the spelling against the
            card names, or wait for the catalog to finish refreshing, then go
            back to the upload and resolve it again.
          </EmptyState>
        )}

        <Ledger aria-label="Rows" className="import__ledger">
          {rows.map((row, index) => (
            <LedgerEntry
              key={index}
              number={index + 1}
              thumb={
                <CardThumb
                  images={row.chosen?.image_uris ?? null}
                  name={row.chosen?.name ?? row.entry.name}
                />
              }
              name={
                <>
                  <RowStatusTag status={row.status} chosen={row.chosen} />{' '}
                  {row.entry.name}
                </>
              }
              where={
                row.chosen ? (
                  <>
                    {chosenLine(row.entry, row.chosen)}
                    {row.status === 'ambiguous' && (
                      <>
                        {' '}
                        <Button
                          variant="ghost"
                          onClick={() => choose(index, null)}
                        >
                          Change
                        </Button>
                      </>
                    )}
                  </>
                ) : row.status === 'ambiguous' ? (
                  <>
                    Several printings match; choose one below.
                    {detailsSentence(row.entry)}
                  </>
                ) : (
                  <>
                    No printing of “{row.entry.name}” resides in the catalog.
                    {detailsSentence(row.entry)}
                  </>
                )
              }
              count={
                <>
                  <LedgerFigure>{row.entry.quantity}</LedgerFigure>
                  <span className="visually-hidden">
                    {row.entry.quantity === 1 ? ' copy' : ' copies'}
                  </span>
                </>
              }
              aside={
                row.status === 'ambiguous' &&
                !row.chosen && (
                  <CandidatePicker
                    name={row.entry.name}
                    candidates={row.candidates}
                    selectedId={null}
                    onPick={(printing) => choose(index, printing)}
                  />
                )
              }
            />
          ))}
        </Ledger>

        <UnreadableRows problems={problems} />

        {error && (
          <Notice tone="danger" role="alert">
            {error}
          </Notice>
        )}

        <Button
          variant="primary"
          seal
          onClick={handleInscribe}
          disabled={busy || readyRows.length === 0}
        >
          {busy
            ? 'Inscribing…'
            : `Inscribe ${readyRows.length} ${readyRows.length === 1 ? 'folio' : 'folios'}`}
        </Button>
        {unresolvedCount + unmatchedCount > 0 && readyRows.length > 0 && (
          <Notice className="decklist__skip-note">
            {unresolvedCount + unmatchedCount} unresolved row
            {unresolvedCount + unmatchedCount === 1 ? '' : 's'} will be skipped.
          </Notice>
        )}
      </section>
    )
  }

  return (
    <section className="decklist">
      <PageHeader title="Import a Collection CSV" />
      <p>
        Upload a CSV exported from Manabox, Deckbox, or Archidekt. The source is
        detected from its columns; finish, condition, and language come from the
        file.
      </p>

      <div className="import__controls">
        <Field label="CSV file">
          {/* Native input: the .control rules are text-field rules, and a file
              picker keeps its own rendering (ADR 0017). */}
          <input
            className="decklist__file"
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => handleFile(event.target.files?.[0])}
          />
        </Field>
        <Field label="Source format">
          <Select
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
          </Select>
        </Field>
      </div>

      <Field label="…or paste CSV text" className="decklist__input">
        <Textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={10}
          placeholder={
            'Name,Set code,Collector number,Foil,Quantity,Scryfall ID,Condition,Language'
          }
        />
      </Field>

      <UnreadableRows problems={problems} />

      {error && (
        <Notice tone="danger" role="alert">
          {error}
        </Notice>
      )}

      <Button
        variant="primary"
        onClick={handleResolve}
        disabled={busy || text.trim().length === 0}
      >
        {busy ? 'Consulting the catalog…' : 'Resolve CSV'}
      </Button>
    </section>
  )
}
