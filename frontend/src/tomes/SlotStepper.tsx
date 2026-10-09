import { useMutation, useQueryClient } from '@tanstack/react-query'
import { updateSlot, type DeckSlot } from '../api'
import { Notice } from '../components'
import { isSingletonBoard } from './boards'
import { invalidateAfterSlotWrite } from './invalidate'
import '../catalog/catalog.css'

/**
 * Step a slot's copy count through the slot PATCH. The Catalog's stepper
 * styling, against a slot instead of a lot. One is the floor; removing a slot
 * is its own button. Commander and companion slots hold exactly one copy, so
 * they get no stepper at all.
 */
export function SlotStepper({ slot }: { slot: DeckSlot }) {
  const queryClient = useQueryClient()
  const adjust = useMutation({
    mutationFn: (quantity: number) =>
      updateSlot(slot.deck_id, slot.id, { quantity }),
    onSuccess: () => invalidateAfterSlotWrite(queryClient),
  })

  if (isSingletonBoard(slot.board)) return null

  const busy = adjust.isPending

  return (
    <span className="qty-stepper">
      <button
        type="button"
        className="qty-stepper__step"
        aria-label={`Decrease quantity of ${slot.card.name}`}
        disabled={busy || slot.quantity <= 1}
        onClick={() => adjust.mutate(slot.quantity - 1)}
      >
        −
      </button>
      <output className="qty-stepper__value">{slot.quantity}</output>
      <button
        type="button"
        className="qty-stepper__step"
        aria-label={`Increase quantity of ${slot.card.name}`}
        disabled={busy}
        onClick={() => adjust.mutate(slot.quantity + 1)}
      >
        +
      </button>
      {/* The reason, not a bare "not saved": a reservation refusal names the
          Tomes that hold the copies. */}
      {adjust.isError && (
        <Notice
          as="span"
          tone="danger"
          role="alert"
          className="qty-stepper__error"
        >
          {adjust.error.message}
        </Notice>
      )}
    </span>
  )
}
