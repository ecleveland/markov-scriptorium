import { useMemo, useState } from 'react'
import {
  CONDITIONS,
  FINISHES,
  inscribe,
  type CardPrinting,
  type Condition,
  type Finish,
  type InventoryLot,
} from '../api'

interface Props {
  printing: CardPrinting
  onInscribed: (lot: InventoryLot) => void
  onChangePrinting: () => void
}

/** Finishes this printing actually exists in (per Scryfall), else nonfoil. */
function availableFinishes(printing: CardPrinting): Finish[] {
  const offered = FINISHES.filter((finish) =>
    printing.finishes?.includes(finish),
  )
  return offered.length > 0 ? offered : ['nonfoil']
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
    const quantity = Math.max(1, Math.floor(Number(quantityText) || 1))
    try {
      const lot = await inscribe({
        scryfall_id: printing.scryfall_id,
        quantity,
        finish,
        condition,
        location: location.trim() || null,
      })
      onInscribed(lot)
    } catch {
      setError('This card could not be inscribed. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="inscribe-form" onSubmit={handleSubmit}>
      <header className="inscribe-form__header">
        <h2>
          {printing.name} — {printing.set_name} (
          {printing.set_code.toUpperCase()}) · #{printing.collector_number}
        </h2>
        <button type="button" onClick={onChangePrinting}>
          Change printing
        </button>
      </header>

      {printing.image_uris?.normal && (
        <img
          className="inscribe-form__preview"
          src={printing.image_uris.normal}
          alt={printing.name}
          width={240}
        />
      )}

      <div className="inscribe-form__fields">
        <label>
          Finish
          <select
            value={finish}
            onChange={(e) => setFinish(e.target.value as Finish)}
          >
            {finishes.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <label>
          Condition
          <select
            value={condition}
            onChange={(e) => setCondition(e.target.value as Condition)}
          >
            {CONDITIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <label>
          Quantity
          <input
            type="number"
            min={1}
            value={quantityText}
            onChange={(e) => setQuantityText(e.target.value)}
          />
        </label>

        <label>
          Volume (location)
          <input
            type="text"
            value={location}
            placeholder="e.g. Binder I"
            onChange={(e) => setLocation(e.target.value)}
          />
        </label>
      </div>

      {error && <p role="alert">{error}</p>}

      <button type="submit" disabled={submitting}>
        {submitting ? 'Inscribing…' : 'Inscribe'}
      </button>
    </form>
  )
}
