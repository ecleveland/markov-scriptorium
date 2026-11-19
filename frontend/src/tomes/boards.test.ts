import { describe, expect, it } from 'vitest'
import { slot } from '../test/fixtures'
import {
  BOARD_LABELS,
  boardOffsets,
  groupByBoard,
  isSingletonBoard,
} from './boards'

describe('boards', () => {
  it('labels every board', () => {
    expect(BOARD_LABELS).toEqual({
      commander: 'Commander',
      companion: 'Companion',
      main: 'Main',
      sideboard: 'Sideboard',
      maybeboard: 'Maybeboard',
    })
  })

  it('knows the one-copy boards', () => {
    expect(isSingletonBoard('commander')).toBe(true)
    expect(isSingletonBoard('companion')).toBe(true)
    expect(isSingletonBoard('main')).toBe(false)
  })

  it('groups rows in rank order, skips empty boards, and sums copies', () => {
    const groups = groupByBoard([
      slot({ id: 1, board: 'sideboard', quantity: 2 }),
      slot({ id: 2, board: 'main', quantity: 4 }),
      slot({ id: 3, board: 'commander', quantity: 1 }),
      slot({ id: 4, board: 'main', quantity: 3 }),
    ])
    expect(
      groups.map((g) => [g.board, g.copies, g.rows.map((r) => r.id)]),
    ).toEqual([
      ['commander', 1, [3]],
      ['main', 7, [2, 4]],
      ['sideboard', 2, [1]],
    ])
  })

  it('starts each group where the rows before it end', () => {
    const groups = groupByBoard([
      slot({ id: 1, board: 'commander' }),
      slot({ id: 2, board: 'main', quantity: 4 }),
      slot({ id: 3, board: 'main', quantity: 2 }),
      slot({ id: 4, board: 'main' }),
      slot({ id: 5, board: 'sideboard' }),
    ])
    // Rows, not copies: the running number counts ledger entries.
    expect(boardOffsets(groups)).toEqual([0, 1, 4])
  })

  it('gives no offsets for no groups', () => {
    expect(boardOffsets([])).toEqual([])
  })
})
