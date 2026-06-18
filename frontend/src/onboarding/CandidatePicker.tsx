import type { CardPrinting } from '../api'

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
  return (
    <ul
      className="candidate-picker"
      role="listbox"
      aria-label={`Printings of ${name}`}
    >
      {candidates.map((printing) => (
        <li
          key={printing.scryfall_id}
          role="option"
          aria-selected={printing.scryfall_id === selectedId}
        >
          <button type="button" onClick={() => onPick(printing)}>
            {printing.image_uris?.small && (
              <img
                src={printing.image_uris.small}
                alt=""
                width={36}
                loading="lazy"
              />
            )}
            <span>
              {printing.set_name} ({printing.set_code.toUpperCase()}) · #
              {printing.collector_number}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
