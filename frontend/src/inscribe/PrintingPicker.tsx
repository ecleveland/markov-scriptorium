import { useEffect, useState } from 'react'
import { searchPrintings, type PrintingsResult } from '../api'
import {
  Button,
  Consulting,
  Notice,
  PageHeader,
  PrintingChip,
} from '../components'
import { useArrowKeyList } from '../hooks/useArrowKeyList'

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
  const arrowKeys = useArrowKeyList()

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
      <PageHeader level={2} title={<>Choose a printing of “{name}”</>}>
        <Button onClick={onCancel}>Change card</Button>
      </PageHeader>

      {failed && (
        <Notice tone="danger" role="alert">
          The printings could not be loaded.
        </Notice>
      )}
      {!failed && result === null && <Consulting />}
      {result !== null && result.printings.length === 0 && (
        <Notice>No printings of this card reside in the catalog.</Notice>
      )}
      {result !== null && result.truncated && (
        <Notice role="status">
          Showing the first {result.printings.length}; refine the name if a
          printing is missing.
        </Notice>
      )}
      {result !== null && result.printings.length > 0 && (
        <ul
          className="listbox printing-picker__list"
          aria-label="Printings"
          {...arrowKeys}
        >
          {result.printings.map((printing) => (
            <li key={printing.scryfall_id}>
              <button
                type="button"
                className="listbox__option"
                onClick={() => onPick(printing)}
              >
                <PrintingChip printing={printing} size="md" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
