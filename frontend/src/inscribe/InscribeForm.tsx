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
import { printingLine } from '../catalog/prose'
import {
  Button,
  CardThumb,
  Field,
  Input,
  Notice,
  Plate,
  Select,
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
      // Surface the backend's reason (a 422 validation detail, say) when we
      // have one, because "try again" misleads for input the server will reject
      // again.
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
      {/* The chosen printing on the lit plate, with the acquisition fields
          among its lines and the seal button beneath them. */}
      <Plate
        label="Inscribe this printing"
        art={
          <CardThumb
            images={printing.image_uris}
            name={printing.name}
            size="full"
          />
        }
        heading={<h2>{printing.name}</h2>}
        lines={
          <>
            <p className="plate__printing">
              {printingLine(printing)}, {printing.rarity}.
            </p>
            <div className="inscribe-form__fields">
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

              <Field label="Volume">
                <Input
                  type="text"
                  value={location}
                  placeholder="e.g. Binder I"
                  onChange={(e) => setLocation(e.target.value)}
                />
              </Field>
            </div>
            {error && (
              <Notice tone="danger" role="alert">
                {error}
              </Notice>
            )}
          </>
        }
        actions={
          <>
            <Button type="submit" variant="primary" seal disabled={submitting}>
              {submitting ? 'Inscribing…' : 'Inscribe'}
            </Button>
            <Button onClick={onChangePrinting}>Change printing</Button>
          </>
        }
      />
    </form>
  )
}
