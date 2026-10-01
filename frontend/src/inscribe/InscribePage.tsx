import { useState } from 'react'
import type { CardPrinting, InventoryLot } from '../api'
import { PageHeader, Panel, Sealed } from '../components'
import { CardSearch } from './CardSearch'
import { InscribeForm } from './InscribeForm'
import { PrintingPicker } from './PrintingPicker'
import './inscribe.css'

interface SessionEntry {
  id: number
  name: string
  setCode: string
  collectorNumber: string
  quantity: number
  finish: string
}

/**
 * One inscription as a line of text. The session list and the seal both use
 * it, so the confirmation always reads the same as the entry it adds.
 */
function describeEntry(entry: SessionEntry): string {
  return `${entry.quantity}× ${entry.name} (${entry.setCode.toUpperCase()} #${entry.collectorNumber}) · ${entry.finish}`
}

/**
 * The Inscribe flow: search a name → pick a printing → set acquisition details
 * → inscribe. After each inscription the flow returns to the search box (which
 * regains focus) so several cards can be added in a row without leaving the
 * page; a running list records what was inscribed this session.
 */
export function InscribePage() {
  const [name, setName] = useState<string | null>(null)
  const [printing, setPrinting] = useState<CardPrinting | null>(null)
  const [session, setSession] = useState<SessionEntry[]>([])
  // The inscription the seal confirms. It stays while the user types the next
  // name and lifts once they choose one, so it never outlives the moment.
  const [lastSealed, setLastSealed] = useState<SessionEntry | null>(null)

  function backToSearch() {
    setName(null)
    setPrinting(null)
  }

  function handleInscribed(lot: InventoryLot) {
    const entry: SessionEntry = {
      id: lot.id,
      name: lot.card.name,
      setCode: lot.card.set_code,
      collectorNumber: lot.card.collector_number,
      quantity: lot.quantity,
      finish: lot.finish,
    }
    setSession((prev) => [entry, ...prev])
    setLastSealed(entry)
    backToSearch()
  }

  function chooseName(chosen: string) {
    setLastSealed(null)
    setName(chosen)
  }

  return (
    <section className="inscribe">
      <PageHeader eyebrow="Inscription" title="Inscribe a Card" />

      {/* Mounted on every step, not only the search step: the flow leaves
          search for the picker and form, and a live region that comes back
          with its text already inside is often not read. The seal clears when
          the next name is chosen, so this is empty outside the search step. */}
      <div role="status">
        {lastSealed && <Sealed>{describeEntry(lastSealed)}</Sealed>}
      </div>

      {name === null && <CardSearch autoFocus onSelect={chooseName} />}

      {name !== null && printing === null && (
        <PrintingPicker
          key={name}
          name={name}
          onPick={setPrinting}
          onCancel={backToSearch}
        />
      )}

      {printing !== null && (
        <InscribeForm
          key={printing.scryfall_id}
          printing={printing}
          onInscribed={handleInscribed}
          onChangePrinting={() => setPrinting(null)}
        />
      )}

      {session.length > 0 && (
        <Panel
          as="aside"
          className="inscribe__session"
          aria-label="Inscribed this session"
        >
          <h2>Inscribed this session</h2>
          <ul>
            {session.map((entry) => (
              <li key={entry.id}>{describeEntry(entry)}</li>
            ))}
          </ul>
        </Panel>
      )}
    </section>
  )
}
