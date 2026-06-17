import { useEffect, useState } from 'react'

/**
 * Returns `value` delayed by `delayMs`, resetting the timer on each change.
 * Used to throttle type-ahead lookups so we query the catalog on a pause in
 * typing rather than every keystroke.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(handle)
  }, [value, delayMs])

  return debounced
}
