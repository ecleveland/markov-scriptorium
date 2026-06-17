/** Coerce the raw quantity field to a positive integer (blank/invalid → 1). */
export function coerceQuantity(text: string): number {
  return Math.max(1, Math.floor(Number(text) || 1))
}
