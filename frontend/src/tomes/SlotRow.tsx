import { useMutation, useQueryClient } from '@tanstack/react-query'
import { deleteSlot, type DeckSlot } from '../api'
import { printingLine } from '../catalog/prose'
import {
  Button,
  CardThumb,
  FinishWord,
  LedgerEntry,
  LedgerFigure,
  Notice,
} from '../components'
import { isSingletonBoard } from './boards'
import { SlotStepper } from './SlotStepper'
import { invalidateAfterSlotWrite } from './invalidate'

/**
 * One slot of the Tome as a ledger entry, with the stepper as its control.
 * A commander or companion holds one copy, so it shows the figure instead.
 * Removing a slot asks no confirmation: a slot is cheap to add back, unlike a
 * whole Tome.
 */
export function SlotRow({ slot, number }: { slot: DeckSlot; number: number }) {
  const queryClient = useQueryClient()
  const remove = useMutation({
    mutationFn: () => deleteSlot(slot.deck_id, slot.id),
    onSuccess: () => invalidateAfterSlotWrite(queryClient),
  })
  const finished = slot.finish === 'foil' || slot.finish === 'etched'

  return (
    <LedgerEntry
      number={number}
      thumb={<CardThumb images={slot.card.image_uris} name={slot.card.name} />}
      name={
        <>
          {slot.card.name}
          {finished && (
            <>
              {' '}
              <FinishWord finish={slot.finish} />
            </>
          )}
        </>
      }
      where={`${printingLine(slot.card)}.`}
      count={
        isSingletonBoard(slot.board) ? (
          <>
            <LedgerFigure>1</LedgerFigure>
            <span className="visually-hidden"> copy</span>
          </>
        ) : (
          <SlotStepper slot={slot} />
        )
      }
      note={
        <>
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
        </>
      }
    />
  )
}
