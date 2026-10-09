import { useMutation, useQueryClient } from '@tanstack/react-query'
import { deleteSlot, type DeckSlot } from '../api'
import { CardThumb } from '../catalog/CardThumb'
import { Button, Notice, describePrinting } from '../components'
import { SlotStepper } from './SlotStepper'
import { invalidateAfterSlotWrite } from './invalidate'

/**
 * One slot of the Tome. Removing it asks no confirmation: a slot is cheap to
 * add back, unlike a whole Tome.
 */
export function SlotRow({ slot }: { slot: DeckSlot }) {
  const queryClient = useQueryClient()
  const remove = useMutation({
    mutationFn: () => deleteSlot(slot.deck_id, slot.id),
    onSuccess: () => invalidateAfterSlotWrite(queryClient),
  })

  return (
    <li className="tome-slot">
      <CardThumb images={slot.card.image_uris} name={slot.card.name} />
      <div className="tome-slot__card">
        <span className="tome-slot__name">{slot.card.name}</span>
        <span className="tome-slot__folio">
          {describePrinting(slot.card)} · {slot.finish}
        </span>
      </div>
      <div className="tome-slot__actions">
        <SlotStepper slot={slot} />
        <Button
          variant="ghost"
          aria-label={`Remove ${slot.card.name}`}
          disabled={remove.isPending}
          onClick={() => remove.mutate()}
        >
          Remove
        </Button>
        {remove.isError && (
          <Notice as="span" tone="danger" role="alert">
            {remove.error.message}
          </Notice>
        )}
      </div>
    </li>
  )
}
