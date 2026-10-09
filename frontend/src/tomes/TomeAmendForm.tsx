import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { updateDeck, type Deck, type DeckPatch } from '../api'
import { Button, Field, Input, Notice, Textarea } from '../components'
import { tomeKeys } from './queryKeys'
import { orNull } from './status'

/**
 * Amend the Tome's name, format, notes, and changelog in one PATCH, folded
 * away until asked for. Keyed on the Tome id by the caller.
 */
export function TomeAmendForm({ deck }: { deck: Deck }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(deck.name)
  const [format, setFormat] = useState(deck.format ?? '')
  const [notes, setNotes] = useState(deck.notes ?? '')
  const [changelog, setChangelog] = useState(deck.changelog ?? '')
  const [blankName, setBlankName] = useState(false)

  const save = useMutation({
    mutationFn: (patch: DeckPatch) => updateDeck(deck.id, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: tomeKeys.all }),
  })

  // Editing after a save clears "Amended.", or it vouches for unsent changes.
  function edited(setter: (value: string) => void) {
    return (value: string) => {
      if (save.isSuccess || save.isError) save.reset()
      setter(value)
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (name.trim() === '') {
      setBlankName(true)
      return
    }
    setBlankName(false)
    save.mutate({
      name: name.trim(),
      format: orNull(format),
      notes: orNull(notes),
      changelog: orNull(changelog),
    })
  }

  return (
    <details className="tome-amend">
      <summary>Amend the Tome</summary>
      <form onSubmit={handleSubmit}>
        <div className="tome-amend__fields">
          <Field label="Name">
            <Input
              type="text"
              value={name}
              onChange={(event) => edited(setName)(event.target.value)}
            />
          </Field>
          <Field label="Format">
            <Input
              type="text"
              value={format}
              onChange={(event) => edited(setFormat)(event.target.value)}
            />
          </Field>
          <Field label="Notes" className="tome-amend__wide">
            <Textarea
              rows={3}
              value={notes}
              onChange={(event) => edited(setNotes)(event.target.value)}
            />
          </Field>
          <Field label="Changelog" className="tome-amend__wide">
            <Textarea
              rows={4}
              value={changelog}
              onChange={(event) => edited(setChangelog)(event.target.value)}
            />
          </Field>
        </div>
        <div className="tome-actions">
          <Button type="submit" variant="primary" disabled={save.isPending}>
            {save.isPending ? 'Amending…' : 'Amend'}
          </Button>
          {blankName && (
            <Notice as="span" tone="danger" role="alert">
              A Tome needs a name.
            </Notice>
          )}
          {save.isSuccess && (
            <Notice as="span" tone="success" role="status">
              Amended.
            </Notice>
          )}
          {save.isError && (
            <Notice as="span" tone="danger" role="alert">
              {save.error.message}
            </Notice>
          )}
        </div>
      </form>
    </details>
  )
}
