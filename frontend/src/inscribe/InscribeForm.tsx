import { useMemo, useState } from 'react'
import {
  ApiError,
  CONDITIONS,
  inscribe,
  type CardPrinting,
  type Condition,
  type Finish,
  type InventoryLot,
} from '../api'
import {
  Button,
  Field,
  Input,
  Notice,
  PageHeader,
  Panel,
  Select,
  describePrinting,
} from '../components'
import { availableFinishes } from './finishes'
import { coerceQuantity } from './quantity'

interface Props {
  printing: CardPrinting
  onInscribed: (lot: InventoryLot) => void
  onChangePrinting: () => void
}

/** The acquisition details for a chosen printing, then POST to inscribe it. */
export function InscribeForm({
  printing,
  onInscribed,
  onChangePrinting,
}: Props) {
  const finishes = useMemo(() => availableFinishes(printing), [printing])
  const [finish, setFinish] = useState<Finish>(finishes[0])
  const [condition, setCondition] = useState<Condition>('NM')
  // Held as raw text so the field can be cleared and retyped; coerced to a
  // positive integer on submit.
  const [quantityText, setQuantityText] = useState('1')
  const [location, setLocation] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    const quantity = coerceQuantity(quantityText)
    try {
      const lot = await inscribe({
        scryfall_id: printing.scryfall_id,
        quantity,
        finish,
        condition,
        location: location.trim() || null,
      })
      onInscribed(lot)
    } catch (err) {
      console.error('Inscribe failed', err)
      // Surface the backend's reason (e.g. a 422 validation detail) when we have
      // one — "try again" is misleading for input the server will reject again.
      const detail = err instanceof ApiError ? err.detail : undefined
      setError(
        detail
          ? `This card could not be inscribed: ${detail}`
          : 'This card could not be inscribed. Please try again.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="inscribe-form" onSubmit={handleSubmit}>
      <PageHeader
        level={2}
        title={
          <>
            {printing.name} — {describePrinting(printing)}
          </>
        }
      >
        <Button onClick={onChangePrinting}>Change printing</Button>
      </PageHeader>

      <div className="inscribe-form__body">
        {printing.image_uris?.normal && (
          <img
            className="inscribe-form__preview"
            src={printing.image_uris.normal}
            alt={printing.name}
            width={240}
          />
        )}

        <Panel className="inscribe-form__fields">
          <Field label="Finish">
            <Select
              value={finish}
              onChange={(e) => setFinish(e.target.value as Finish)}
            >
              {finishes.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Condition">
            <Select
              value={condition}
              onChange={(e) => setCondition(e.target.value as Condition)}
            >
              {CONDITIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Quantity">
            <Input
              type="number"
              min={1}
              value={quantityText}
              onChange={(e) => setQuantityText(e.target.value)}
            />
          </Field>

          <Field label="Volume (location)">
            <Input
              type="text"
              value={location}
              placeholder="e.g. Binder I"
              onChange={(e) => setLocation(e.target.value)}
            />
          </Field>
        </Panel>
      </div>

      {error && (
        <Notice tone="danger" role="alert">
          {error}
        </Notice>
      )}

      <Button type="submit" variant="primary" seal disabled={submitting}>
        {submitting ? 'Inscribing…' : 'Inscribe'}
      </Button>
    </form>
  )
}
