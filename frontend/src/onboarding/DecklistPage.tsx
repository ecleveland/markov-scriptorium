import { useState } from 'react'
import {
  CONDITIONS,
  FINISHES,
  MAX_BULK_ROWS,
  inscribeBulk,
  parseDecklist,
  resolveDecklist,
  type CardPrinting,
  type Condition,
  type Finish,
  type ParsedLine,
  type ParseProblem,
} from '../api'
import {
  Button,
  Field,
  Notice,
  PageHeader,
  Panel,
  Select,
  Textarea,
  describePrinting,
} from '../components'
import { CandidatePicker } from './CandidatePicker'
import { errorMessage } from './errorMessage'
import { RowStatusTag } from './RowStatusTag'
import { UnreadableProblems } from './UnreadableProblems'
import './decklist.css'

/**
 * A parsed line paired with how it resolved. A discriminated union so the three
 * outcomes are the only representable states: a `matched` row always carries the
 * printing to inscribe, only an `ambiguous` row carries candidates and a pending
 * pick, and an `unmatched` row carries neither.
 */
type PreviewRow =
  | { entry: ParsedLine; status: 'matched'; chosen: CardPrinting }
  | {
      entry: ParsedLine
      status: 'ambiguous'
      candidates: CardPrinting[]
      chosen: CardPrinting | null
    }
  | { entry: ParsedLine; status: 'unmatched'; chosen: null }

type Step = 'paste' | 'preview' | 'summary'

/** The per-line parse problems, shown on both the paste and preview steps. */
function UnreadableLines({ problems }: { problems: ParseProblem[] }) {
  return (
    <UnreadableProblems
      label="Unreadable lines"
      noun="Line"
      problems={problems.map((problem) => ({
        number: problem.line_number,
        reason: problem.reason,
        text: problem.text,
      }))}
    />
  )
}

/**
 * Inscribe a whole decklist at once: paste text → resolve every line against the
 * catalog → disambiguate the rows that matched several printings → inscribe the
 * lot in one atomic batch. Unmatched and unresolved lines are reported in the
 * summary, never silently dropped (VEG-414).
 */
export function DecklistPage() {
  const [step, setStep] = useState<Step>('paste')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [problems, setProblems] = useState<ParseProblem[]>([])
  const [rows, setRows] = useState<PreviewRow[]>([])
  // Decklists carry no finish/condition, so one choice applies to the whole import.
  const [finish, setFinish] = useState<Finish>('nonfoil')
  const [condition, setCondition] = useState<Condition>('NM')
  const [summary, setSummary] = useState<{
    lots: number
    copies: number
    skipped: number
  } | null>(null)

  // Narrow to rows with a printing so the inscribe mapping needs no `!`.
  const readyRows = rows.filter(
    (row): row is PreviewRow & { chosen: CardPrinting } => row.chosen !== null,
  )
  const unresolvedCount = rows.filter(
    (row) => row.status === 'ambiguous' && !row.chosen,
  ).length
  const unmatchedCount = rows.filter((row) => row.status === 'unmatched').length

  async function handleResolve() {
    setBusy(true)
    setError(null)
    try {
      const parsed = await parseDecklist(text)
      setProblems(parsed.problems)
      if (parsed.entries.length === 0) {
        setError(
          parsed.problems.length > 0
            ? 'No readable card lines were found — see the problems below.'
            : 'Paste a decklist to begin.',
        )
        return
      }
      if (parsed.entries.length > MAX_BULK_ROWS) {
        setError(
          `That decklist has ${parsed.entries.length} lines; the importer accepts at most ${MAX_BULK_ROWS} at a time.`,
        )
        return
      }
      const resolved = await resolveDecklist(
        parsed.entries.map((entry) => ({
          name: entry.name,
          set_code: entry.set_code,
          collector_number: entry.collector_number,
          quantity: entry.quantity,
        })),
      )
      // resolve preserves order 1:1; if the counts diverge the response is
      // unusable — say so plainly instead of letting an undefined row read as a
      // network error below.
      if (resolved.results.length !== parsed.entries.length) {
        setError(
          `The catalog returned ${resolved.results.length} results for ${parsed.entries.length} lines; nothing was imported.`,
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
          // 'unmatched', or the contract-violating 'matched' with no printing.
          return { entry, status: 'unmatched', chosen: null }
        }),
      )
      setStep('preview')
    } catch (err) {
      console.error('Resolving the decklist failed', err)
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  function choose(index: number, printing: CardPrinting | null) {
    // Only ambiguous rows expose a picker, so only they are re-chosen.
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
          finish,
          condition,
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
    setStep('paste')
    setText('')
    setRows([])
    setProblems([])
    setSummary(null)
    setError(null)
  }

  if (step === 'summary' && summary) {
    return (
      <section className="decklist">
        <PageHeader eyebrow="Decklist import" title="Decklist Inscribed" />
        <Notice tone="success" role="status" className="decklist__summary">
          Inscribed {summary.lots} {summary.lots === 1 ? 'folio' : 'folios'} (
          {summary.copies} {summary.copies === 1 ? 'copy' : 'copies'}) into the
          catalog.
          {summary.skipped > 0 &&
            ` ${summary.skipped} line${summary.skipped === 1 ? '' : 's'} skipped.`}
        </Notice>
        <Button onClick={reset}>Inscribe another decklist</Button>
      </section>
    )
  }

  if (step === 'preview') {
    return (
      <section className="decklist">
        <PageHeader eyebrow="Decklist import" title="Review the Decklist">
          <Button onClick={() => setStep('paste')}>Edit decklist</Button>
        </PageHeader>

        <Notice className="decklist__counts">
          {readyRows.length} ready · {unresolvedCount} to choose ·{' '}
          {unmatchedCount} unmatched
          {problems.length > 0 && ` · ${problems.length} unreadable`}
        </Notice>

        <Panel as="fieldset" className="decklist__controls">
          <legend>Applied to every inscribed card</legend>
          <Field label="Finish">
            <Select
              value={finish}
              onChange={(event) => setFinish(event.target.value as Finish)}
            >
              {FINISHES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Condition">
            <Select
              value={condition}
              onChange={(event) =>
                setCondition(event.target.value as Condition)
              }
            >
              {CONDITIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          </Field>
        </Panel>

        <ol className="decklist__rows">
          {rows.map((row, index) => (
            <li
              key={index}
              className={`decklist__row decklist__row--${row.status}`}
            >
              <RowStatusTag status={row.status} chosen={row.chosen} />
              <span className="decklist__line">
                {row.entry.quantity}× {row.entry.name}
              </span>
              {row.chosen ? (
                <span className="decklist__chosen">
                  {describePrinting(row.chosen)}
                  {row.status === 'ambiguous' && (
                    <Button variant="ghost" onClick={() => choose(index, null)}>
                      Change
                    </Button>
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

        <UnreadableLines problems={problems} />

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
            {unresolvedCount + unmatchedCount} unresolved line
            {unresolvedCount + unmatchedCount === 1 ? '' : 's'} will be skipped.
          </Notice>
        )}
      </section>
    )
  }

  return (
    <section className="decklist">
      <PageHeader eyebrow="Decklist import" title="Inscribe a Decklist" />
      <p>
        Paste a decklist — one card per line, e.g.{' '}
        <code>4 Lightning Bolt (2X2)</code>. Quantities, set codes, comments,
        and section headers are understood.
      </p>
      <Field label="Decklist" className="decklist__input">
        <Textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={12}
          placeholder={
            'Deck\n4 Lightning Bolt\n2 Counterspell\n1 Sol Ring (cmd)'
          }
        />
      </Field>

      <UnreadableLines problems={problems} />

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
        {busy ? 'Consulting the catalog…' : 'Resolve decklist'}
      </Button>
    </section>
  )
}
