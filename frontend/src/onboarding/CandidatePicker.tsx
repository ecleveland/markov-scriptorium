import type { CardPrinting } from '../api'
import { PrintingChip } from '../components'
import { useArrowKeyList } from '../hooks/useArrowKeyList'

interface Props {
  name: string
  candidates: CardPrinting[]
  selectedId: string | null
  onPick: (printing: CardPrinting) => void
}

/**
 * Pick one printing for an ambiguous import row. Unlike the Inscribe flow's
 * PrintingPicker (which re-queries the catalog by name), this renders the
 * candidate printings the resolve step already returned — one catalog round-trip
 * per import, and the choices can't drift from what resolution actually matched.
 */
export function CandidatePicker({
  name,
  candidates,
  selectedId,
  onPick,
}: Props) {
  const arrowKeys = useArrowKeyList()
  return (
    <ul
      className="listbox candidate-picker"
      aria-label={`Printings of ${name}`}
      {...arrowKeys}
    >
      {candidates.map((printing) => (
        <li key={printing.scryfall_id}>
          <button
            type="button"
            className="listbox__option"
            aria-pressed={printing.scryfall_id === selectedId}
            onClick={() => onPick(printing)}
          >
            <PrintingChip printing={printing} />
          </button>
        </li>
      ))}
    </ul>
  )
}
