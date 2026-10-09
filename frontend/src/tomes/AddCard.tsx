import { useState } from 'react'
import type { CardPrinting } from '../api'
import { Notice, Panel } from '../components'
import { CardSearch } from '../inscribe/CardSearch'
import { PrintingPicker } from '../inscribe/PrintingPicker'
import { SlotForm } from './SlotForm'
import '../inscribe/inscribe.css'

/**
 * Inscribe's search-then-pick flow, ending in a slot instead of a lot. After
 * each add the flow returns to the search box so several cards go in a row.
 */
export function AddCard({ deckId }: { deckId: number }) {
  const [name, setName] = useState<string | null>(null)
  const [printing, setPrinting] = useState<CardPrinting | null>(null)
  const [added, setAdded] = useState<string | null>(null)

  function backToSearch() {
    setName(null)
    setPrinting(null)
  }

  function chooseName(chosen: string) {
    setAdded(null)
    setName(chosen)
  }

  return (
    <Panel as="section" className="tome-add" aria-labelledby="tome-add-title">
      <h2 id="tome-add-title">Add a card</h2>

      {/* Mounted on every step, so the confirmation is announced. */}
      <div role="status">
        {added && <Notice tone="success">{added}</Notice>}
      </div>

      {name === null && <CardSearch onSelect={chooseName} />}

      {name !== null && printing === null && (
        <PrintingPicker
          key={name}
          name={name}
          onPick={setPrinting}
          onCancel={backToSearch}
        />
      )}

      {printing !== null && (
        <SlotForm
          key={printing.scryfall_id}
          deckId={deckId}
          printing={printing}
          onAdded={(summary) => {
            setAdded(summary)
            backToSearch()
          }}
          onChangePrinting={() => setPrinting(null)}
        />
      )}
    </Panel>
  )
}
