import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState, type FormEvent } from 'react'
import {
  BOARDS,
  addSlot,
  type Board,
  type CardPrinting,
  type Finish,
  type SlotCreate,
} from '../api'
import { readQuantity } from '../catalog/quantity'
import {
  Button,
  Field,
  Input,
  Notice,
  PageHeader,
  Panel,
  Select,
  describePrinting,
} from '../components'
import { availableFinishes } from '../inscribe/finishes'
import { BOARD_LABELS, isSingletonBoard } from './boards'
import { invalidateAfterSlotWrite } from './invalidate'

interface Props {
  deckId: number
  printing: CardPrinting
  /** Called with a line describing what was added. */
  onAdded: (summary: string) => void
  onChangePrinting: () => void
}

/** Finish, board, and copies for a chosen printing, then POST the slot. */
export function SlotForm({
  deckId,
  printing,
  onAdded,
  onChangePrinting,
}: Props) {
  const queryClient = useQueryClient()
  const finishes = useMemo(() => availableFinishes(printing), [printing])
  const [finish, setFinish] = useState<Finish>(finishes[0])
  const [board, setBoard] = useState<Board>('main')
  const [quantityText, setQuantityText] = useState('1')
  const [badQuantity, setBadQuantity] = useState(false)

  const singleton = isSingletonBoard(board)

  const add = useMutation({
    mutationFn: (body: SlotCreate) => addSlot(deckId, body),
    onSuccess: async (_slot, body) => {
      await invalidateAfterSlotWrite(queryClient)
      onAdded(
        `Added ${body.quantity ?? 1}× ${printing.name} to ${BOARD_LABELS[body.board ?? 'main']}.`,
      )
    },
  })

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const quantity = singleton ? 1 : readQuantity(quantityText)
    if (quantity === null) {
      setBadQuantity(true)
      return
    }
    setBadQuantity(false)
    add.mutate({ scryfall_id: printing.scryfall_id, finish, board, quantity })
  }

  return (
    <form className="slot-form" onSubmit={handleSubmit}>
      <PageHeader
        level={2}
        title={
          <>
            {printing.name} · {describePrinting(printing)}
          </>
        }
      >
        <Button onClick={onChangePrinting}>Change printing</Button>
      </PageHeader>

      <Panel className="slot-form__fields">
        <Field label="Finish">
          <Select
            value={finish}
            onChange={(event) => setFinish(event.target.value as Finish)}
          >
            {finishes.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Board">
          <Select
            value={board}
            onChange={(event) => setBoard(event.target.value as Board)}
          >
            {BOARDS.map((option) => (
              <option key={option} value={option}>
                {BOARD_LABELS[option]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Quantity">
          <Input
            type="number"
            min={1}
            disabled={singleton}
            value={singleton ? '1' : quantityText}
            onChange={(event) => setQuantityText(event.target.value)}
          />
        </Field>
      </Panel>

      {badQuantity && (
        <Notice tone="danger" role="alert">
          A slot holds at least one copy.
        </Notice>
      )}
      {/* A reservation refusal's message already names the holding Tomes. */}
      {add.isError && (
        <Notice tone="danger" role="alert">
          {add.error.message}
        </Notice>
      )}

      <Button type="submit" variant="primary" disabled={add.isPending}>
        {add.isPending ? 'Adding…' : 'Add to the Tome'}
      </Button>
    </form>
  )
}
