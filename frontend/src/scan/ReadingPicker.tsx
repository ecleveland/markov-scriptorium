import type { Reading } from '../api'
import { useArrowKeyList } from '../hooks/useArrowKeyList'

interface Props {
  readings: Reading[]
  onPick: (name: string) => void
}

/** The names the scanner read off the card, best first, to pick one from. */
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
            onClick={() => onPick(reading.name)}
          >
            {reading.name}{' '}
            <span className="reading-picker__confidence">
              {Math.round(reading.confidence * 100)}%
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
