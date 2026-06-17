import { useState } from 'react'
import type { CardPrinting, InventoryLot } from '../api'
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
 * The Inscribe flow: search a name → pick a printing → set acquisition details
 * → inscribe. After each inscription the flow returns to the search box (which
 * regains focus) so several cards can be added in a row without leaving the
 * page; a running list records what was inscribed this session.
 */
export function InscribePage() {
  const [name, setName] = useState<string | null>(null)
  const [printing, setPrinting] = useState<CardPrinting | null>(null)
  const [session, setSession] = useState<SessionEntry[]>([])

  function backToSearch() {
    setName(null)
    setPrinting(null)
  }

  function handleInscribed(lot: InventoryLot) {
    setSession((prev) => [
      {
        id: lot.id,
        name: lot.card.name,
        setCode: lot.card.set_code,
        collectorNumber: lot.card.collector_number,
        quantity: lot.quantity,
        finish: lot.finish,
      },
      ...prev,
    ])
    backToSearch()
  }

  return (
    <section className="inscribe">
      <h1>Inscribe a Card</h1>

      {name === null && <CardSearch autoFocus onSelect={setName} />}

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
        <aside
          className="inscribe__session"
          aria-label="Inscribed this session"
        >
          <h2>Inscribed this session</h2>
          <ul>
            {session.map((entry) => (
              <li key={entry.id}>
                {entry.quantity}× {entry.name} ({entry.setCode.toUpperCase()} #
                {entry.collectorNumber}) · {entry.finish}
              </li>
            ))}
          </ul>
        </aside>
      )}
    </section>
  )
}
