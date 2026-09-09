/**
 * Read an amended copy count, or `null` when the field does not hold one.
 *
 * Deliberately not Inscribe's `coerceQuantity`, which reads a blank field as 1.
 * That is a sensible default when creating a lot and a destructive one when
 * amending an existing folio: clearing the field on a 12-copy record would
 * quietly write 1 over it. The schema's `CHECK (quantity > 0)` sets the floor.
 */
export function readQuantity(text: string): number | null {
  const value = Number(text)
  return Number.isInteger(value) && value > 0 ? value : null
}
