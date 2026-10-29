import type { Reading } from '../api'
import { describePrinting } from '../components/printing'
import { useArrowKeyList } from '../hooks/useArrowKeyList'

interface Props {
  readings: Reading[]
  onPick: (reading: Reading) => void
}

/**
 * The names the scanner read off the card, best first, to pick one from. A
 * reading that pinned its printing names the set and number too.
 */
export function ReadingPicker({ readings, onPick }: Props) {
  const arrowKeys = useArrowKeyList()
  return (
    <ul
      className="listbox reading-picker"
      aria-label="Cards the glass read"
      {...arrowKeys}
    >
      {/* The contract does not promise unique names, so the key carries the
          position too. The list is replaced whole, never reordered. */}
      {readings.map((reading, index) => (
        <li key={`${index}-${reading.name}`}>
          <button
            type="button"
            className="listbox__option"
            onClick={() => onPick(reading)}
          >
            {reading.name}{' '}
            {reading.printing && (
              <>
                <span className="reading-picker__printing">
                  {describePrinting(reading.printing)}
                </span>{' '}
              </>
            )}
            <span className="reading-picker__confidence">
              {Math.round(reading.confidence * 100)}%
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
