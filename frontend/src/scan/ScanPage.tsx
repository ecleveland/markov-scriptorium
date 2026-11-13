import { useEffect, useRef, useState } from 'react'
import {
  ApiError,
  recognizeCard,
  type CardPrinting,
  type InventoryLot,
  type Reading,
} from '../api'
import {
  Button,
  Consulting,
  Notice,
  PageHeader,
  Panel,
  Sealed,
} from '../components'
import { CardSearch } from '../inscribe/CardSearch'
import { InscribeForm } from '../inscribe/InscribeForm'
import { PrintingPicker } from '../inscribe/PrintingPicker'
import {
  describeEntry,
  entryFromLot,
  type SessionEntry,
} from '../inscribe/session'
import { CameraCapture } from './CameraCapture'
import { ReadingPicker } from './ReadingPicker'
import './scan.css'

/** The captured frame and the object URL the still is drawn from. */
interface Still {
  image: Blob
  previewUrl: string
}

type ReadingsStep = {
  kind: 'readings'
  still: Still
  readings: Reading[]
  failure: string | null
}

type TypingStep = { kind: 'typing'; still: Still }

/** Where a chosen name came from, so cancelling the picker goes back there. */
type NameSource = ReadingsStep | TypingStep

type Step =
  | { kind: 'camera' }
  | { kind: 'captured'; still: Still }
  | { kind: 'reading'; still: Still }
  | ReadingsStep
  | TypingStep
  | { kind: 'name'; still: Still; name: string; from: NameSource }
  | {
      kind: 'printing'
      still: Still
      name: string
      from: NameSource
      printing: CardPrinting
    }

const READ_FAILED = 'The card could not be read. Try again.'
const READ_TIMED_OUT =
  'The glass did not answer. Try the capture again, or type the name instead.'

/**
 * How long the glass has to answer before the page gives up on it. A live
 * backend can run three title passes at up to 10 seconds each under Tesseract
 * (see `_TIMEOUT_SECONDS` in the tesseract engine), so this leaves room above
 * that sum for a slow but working read to come back with its own answer.
 */
const READ_TIMEOUT_MS = 45_000

/**
 * The Scrying Glass: capture a card on the camera, let the scanner read its
 * name, then settle the folio with the Inscribe flow's own printing picker and
 * form. Each inscription returns to the camera, so a stack of cards can be
 * scried in a row. When the glass cannot read a card, the name can be typed.
 */
export function ScanPage() {
  const [step, setStep] = useState<Step>({ kind: 'camera' })
  const [session, setSession] = useState<SessionEntry[]>([])
  // The inscription the seal confirms, lifted when the next frame is taken.
  const [lastSealed, setLastSealed] = useState<SessionEntry | null>(null)
  // The recognize request in flight, aborted on Retake and on leaving.
  const readingRef = useRef<AbortController | null>(null)
  // The timer that gives up on that request, cleared wherever a read ends.
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The object URL of the current still, so leaving the page can free it.
  const previewRef = useRef<string | null>(null)

  function clearReadTimeout() {
    if (timeoutRef.current !== null) clearTimeout(timeoutRef.current)
    timeoutRef.current = null
  }

  useEffect(() => {
    return () => {
      clearReadTimeout()
      readingRef.current?.abort()
      if (previewRef.current) URL.revokeObjectURL(previewRef.current)
    }
  }, [])

  function letGoOfStill() {
    clearReadTimeout()
    readingRef.current?.abort()
    readingRef.current = null
    if (previewRef.current) URL.revokeObjectURL(previewRef.current)
    previewRef.current = null
  }

  function retake() {
    letGoOfStill()
    setStep({ kind: 'camera' })
  }

  function handleCapture(image: Blob, previewUrl: string) {
    // Nothing should replace a still that is on show, but if a frame does,
    // the one it replaces is freed rather than leaked.
    if (previewRef.current) URL.revokeObjectURL(previewRef.current)
    previewRef.current = previewUrl
    setLastSealed(null)
    setStep({ kind: 'captured', still: { image, previewUrl } })
  }

  async function read(still: Still) {
    clearReadTimeout()
    readingRef.current?.abort()
    const controller = new AbortController()
    readingRef.current = controller
    // A plain timer rather than AbortSignal.timeout, because fake timers in
    // the tests cannot drive that one. The timer shows the notice itself
    // instead of waiting for the request to reject, so a request that ignores
    // the abort still lets the page go.
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null
      if (readingRef.current !== controller) return
      readingRef.current = null
      controller.abort(
        new DOMException('The glass did not answer.', 'TimeoutError'),
      )
      setStep({
        kind: 'readings',
        still,
        readings: [],
        failure: READ_TIMED_OUT,
      })
    }, READ_TIMEOUT_MS)
    setStep({ kind: 'reading', still })
    try {
      const { readings } = await recognizeCard(still.image, controller.signal)
      if (controller.signal.aborted) return
      setStep({ kind: 'readings', still, readings, failure: null })
    } catch (err) {
      if (controller.signal.aborted) return
      console.error('Reading the card failed', err)
      const failure =
        err instanceof ApiError && err.detail ? err.detail : READ_FAILED
      setStep({ kind: 'readings', still, readings: [], failure })
    } finally {
      if (readingRef.current === controller) {
        clearReadTimeout()
        readingRef.current = null
      }
    }
  }

  function handleInscribed(lot: InventoryLot) {
    const entry = entryFromLot(lot)
    setSession((prev) => [entry, ...prev])
    setLastSealed(entry)
    letGoOfStill()
    setStep({ kind: 'camera' })
  }

  const retakeButton = <Button onClick={retake}>Retake</Button>

  function stillImage(still: Still) {
    return (
      <img
        className="scan__still"
        src={still.previewUrl}
        alt="The captured frame"
      />
    )
  }

  return (
    <section className="scan">
      <PageHeader title="Scry a Card" />

      {/* Mounted on every step for the reason InscribePage gives: a live
          region that returns with its text already inside is often not
          read. The seal clears when the next frame is captured. */}
      <div role="status">
        {lastSealed && <Sealed>{describeEntry(lastSealed)}</Sealed>}
      </div>

      {/* Mounted for the whole visit and hidden off the camera step, so the
          stream stays open, rested while hidden, and the flip setting holds
          from card to card. The hidden attribute also takes it out of the
          accessibility tree. */}
      <div hidden={step.kind !== 'camera'}>
        <CameraCapture
          active={step.kind === 'camera'}
          onCapture={handleCapture}
        />
      </div>

      {step.kind === 'captured' && (
        <>
          {stillImage(step.still)}
          <div className="scan__actions">
            {retakeButton}
            <Button variant="primary" onClick={() => read(step.still)}>
              Read the card
            </Button>
          </div>
        </>
      )}

      {step.kind === 'reading' && (
        <>
          {stillImage(step.still)}
          <Consulting role="status">Reading the card…</Consulting>
          <div className="scan__actions">{retakeButton}</div>
        </>
      )}

      {step.kind === 'readings' && (
        <>
          <div className="scan__result">
            {stillImage(step.still)}
            <div className="scan__readings">
              {step.failure !== null ? (
                <Notice tone="danger" role="alert">
                  {step.failure}
                </Notice>
              ) : step.readings.length > 0 ? (
                <ReadingPicker
                  readings={step.readings}
                  onPick={(reading) =>
                    // A reading that pinned its printing skips the picker.
                    // "Change printing" on the form still opens it.
                    setStep(
                      reading.printing
                        ? {
                            kind: 'printing',
                            still: step.still,
                            name: reading.name,
                            from: step,
                            printing: reading.printing,
                          }
                        : {
                            kind: 'name',
                            still: step.still,
                            name: reading.name,
                            from: step,
                          },
                    )
                  }
                />
              ) : (
                <Notice role="status">
                  The glass could not make out a name.
                </Notice>
              )}
            </div>
          </div>
          <div className="scan__actions">
            {retakeButton}
            <Button
              onClick={() => setStep({ kind: 'typing', still: step.still })}
            >
              Type the name instead
            </Button>
          </div>
        </>
      )}

      {step.kind === 'typing' && (
        <>
          <div className="scan__result">
            {stillImage(step.still)}
            <div className="scan__readings">
              <CardSearch
                autoFocus
                onSelect={(name) =>
                  setStep({ kind: 'name', still: step.still, name, from: step })
                }
              />
            </div>
          </div>
          <div className="scan__actions">{retakeButton}</div>
        </>
      )}

      {step.kind === 'name' && (
        <PrintingPicker
          key={step.name}
          name={step.name}
          onPick={(printing) =>
            setStep({ ...step, kind: 'printing', printing })
          }
          onCancel={() => setStep(step.from)}
        />
      )}

      {step.kind === 'printing' && (
        <InscribeForm
          key={step.printing.scryfall_id}
          printing={step.printing}
          onInscribed={handleInscribed}
          onChangePrinting={() =>
            setStep({
              kind: 'name',
              still: step.still,
              name: step.name,
              from: step.from,
            })
          }
        />
      )}

      {session.length > 0 && (
        <Panel
          as="aside"
          className="scan__session"
          aria-label="Scried this session"
        >
          <h2>Scried this session</h2>
          <ul>
            {session.map((entry) => (
              <li key={entry.id}>{describeEntry(entry)}</li>
            ))}
          </ul>
        </Panel>
      )}
    </section>
  )
}
