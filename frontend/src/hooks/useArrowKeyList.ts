import type { KeyboardEvent } from 'react'

function focusByKey(event: KeyboardEvent<HTMLElement>) {
  const options = Array.from(
    event.currentTarget.querySelectorAll<HTMLButtonElement>('.listbox__option'),
  )
  if (options.length === 0) return
  const current = options.indexOf(document.activeElement as HTMLButtonElement)
  const last = options.length - 1
  let next: number
  switch (event.key) {
    case 'ArrowDown':
      next = current === -1 || current === last ? 0 : current + 1
      break
    case 'ArrowUp':
      next = current <= 0 ? last : current - 1
      break
    case 'Home':
      next = 0
      break
    case 'End':
      next = last
      break
    default:
      return
  }
  // Only the keys we handle are claimed, so the page does not scroll under
  // them and every other key (Enter, Tab, typing) behaves as usual.
  event.preventDefault()
  options[next].focus()
}

/**
 * Arrow-key focus movement for a picker list. Spread the result on the
 * container: ArrowDown and ArrowUp move to the next and previous option
 * (wrapping), Home and End to the first and last.
 *
 * Options are found by the `.listbox__option` class, so the buttons must carry
 * it. Every option stays in the tab order; a roving tabindex upgrade would
 * live here so all the pickers pick it up at once.
 */
export function useArrowKeyList(): {
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void
} {
  // The handler keeps no state, so one module-level function is stable across
  // renders without useCallback.
  return { onKeyDown: focusByKey }
}
