import { useEffect, useState } from 'react'
import { searchPrintings, type PrintingsResult } from '../api'

interface Props {
  name: string
  onPick: (printing: PrintingsResult['printings'][number]) => void
  onCancel: () => void
}

/**
 * Lists the printings of the chosen card name (same name across sets = distinct
 * printings) so the user inscribes a specific folio, not just a name.
 */
export function PrintingPicker({ name, onPick, onCancel }: Props) {
  const [result, setResult] = useState<PrintingsResult | null>(null)
  const [failed, setFailed] = useState(false)

  // The parent gives this component a `key={name}`, so each card name gets a
  // fresh mount (result === null → loading) rather than a synchronous reset.
  useEffect(() => {
    const controller = new AbortController()
    searchPrintings(name, controller.signal)
      .then(setResult)
      .catch((err) => {
        if (controller.signal.aborted) return
        console.error('Loading printings failed', err)
        setFailed(true)
      })
    return () => controller.abort()
  }, [name])

  return (
    <section className="printing-picker">
      <header className="printing-picker__header">
        <h2>Choose a printing of “{name}”</h2>
        <button type="button" onClick={onCancel}>
          Change card
        </button>
      </header>

      {failed && <p role="alert">The printings could not be loaded.</p>}
      {!failed && result === null && <p>Consulting the catalog…</p>}
      {result !== null && result.printings.length === 0 && (
        <p>No printings of this card reside in the catalog.</p>
      )}
      {result !== null && result.truncated && (
        <p className="printing-picker__truncated" role="status">
          Showing the first {result.printings.length}; refine the name if a
          printing is missing.
        </p>
      )}
      {result !== null && result.printings.length > 0 && (
        <ul
          className="printing-picker__list"
          role="listbox"
          aria-label="Printings"
        >
          {result.printings.map((printing) => (
            <li key={printing.scryfall_id} role="option" aria-selected={false}>
              <button type="button" onClick={() => onPick(printing)}>
                {printing.image_uris?.small && (
                  <img
                    src={printing.image_uris.small}
                    alt=""
                    width={48}
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
      )}
    </section>
  )
}
