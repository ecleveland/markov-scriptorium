import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { createDeck, type DeckCreate } from '../api'
import { Button, Field, Input, Notice, Panel } from '../components'
import { tomeKeys } from './queryKeys'
import { orNull } from './status'

/**
 * Bind a new Tome: a name, an optional format, and whether it claims its cards.
 * Status starts at in progress on the backend. A commander is added in the
 * editor as a commander slot, which is the only place the schema keeps one.
 */
export function TomeCreateForm() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [format, setFormat] = useState('')
  const [claims, setClaims] = useState(true)
  const [blankName, setBlankName] = useState(false)

  const bind = useMutation({
    mutationFn: (body: DeckCreate) => createDeck(body),
    onSuccess: (deck) => {
      queryClient.invalidateQueries({ queryKey: tomeKeys.all })
      navigate(`/tomes/${deck.id}`)
    },
  })

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (name.trim() === '') {
      setBlankName(true)
      return
    }
    setBlankName(false)
    bind.mutate({
      name: name.trim(),
      format: orNull(format),
      claims_cards: claims,
    })
  }

  return (
    <Panel as="section" className="tome-create" aria-label="Bind a new Tome">
      <h2>Bind a new Tome</h2>
      <form onSubmit={handleSubmit}>
        <div className="tome-create__fields">
          <Field label="Name">
            <Input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field label="Format">
            <Input
              type="text"
              value={format}
              placeholder="commander, modern, cube…"
              onChange={(event) => setFormat(event.target.value)}
            />
          </Field>
          <label className="tome-check">
            <input
              type="checkbox"
              checked={claims}
              onChange={(event) => setClaims(event.target.checked)}
            />
            This Tome claims its cards
          </label>
        </div>
        <div className="tome-actions">
          <Button type="submit" variant="primary" disabled={bind.isPending}>
            {bind.isPending ? 'Binding…' : 'Bind the Tome'}
          </Button>
          {blankName && (
            <Notice as="span" tone="danger" role="alert">
              A Tome needs a name.
            </Notice>
          )}
          {bind.isError && (
            <Notice as="span" tone="danger" role="alert">
              {bind.error.message}
            </Notice>
          )}
        </div>
      </form>
    </Panel>
  )
}
