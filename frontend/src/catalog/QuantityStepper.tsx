import { useMutation, useQueryClient } from '@tanstack/react-query'
import { updateLot, type InventoryLot } from '../api'
import { inventoryKeys } from './queryKeys'

/**
 * Adjust a lot's quantity from the list, without opening the full edit form.
 *
 * One is the floor: the schema's `CHECK (quantity > 0)` would reject zero, and
 * decrementing a lot out of existence is a surprising way to delete something.
 * Removing a lot is the explicit action on the detail view.
 */
export function QuantityStepper({ lot }: { lot: InventoryLot }) {
  const queryClient = useQueryClient()
  const adjust = useMutation({
    mutationFn: (quantity: number) => updateLot(lot.id, { quantity }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: inventoryKeys.all }),
  })

  const busy = adjust.isPending

  return (
    <span className="qty-stepper">
      <button
        type="button"
        className="qty-stepper__step"
        aria-label={`Decrease quantity of ${lot.card.name}`}
        disabled={busy || lot.quantity <= 1}
        onClick={() => adjust.mutate(lot.quantity - 1)}
      >
        −
      </button>
      <output className="qty-stepper__value">{lot.quantity}</output>
      <button
        type="button"
        className="qty-stepper__step"
        aria-label={`Increase quantity of ${lot.card.name}`}
        disabled={busy}
        onClick={() => adjust.mutate(lot.quantity + 1)}
      >
        +
      </button>
      {adjust.isError && (
        <span className="qty-stepper__error" role="alert">
          not saved
        </span>
      )}
    </span>
  )
}
