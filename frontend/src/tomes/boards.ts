import { BOARDS, type Board } from '../api'

export const BOARD_LABELS: Record<Board, string> = {
  commander: 'Commander',
  companion: 'Companion',
  main: 'Main',
  sideboard: 'Sideboard',
  maybeboard: 'Maybeboard',
}

/** Commander and companion slots hold exactly one copy (the schema CHECK). */
export function isSingletonBoard(board: Board): boolean {
  return board === 'commander' || board === 'companion'
}

export interface BoardGroup<T> {
  board: Board
  rows: T[]
  /** Copies across the group's rows. */
  copies: number
}

/** Rows grouped by board in rank order. Boards with no rows are left out, and
 *  each group keeps its rows in the order given. */
export function groupByBoard<T extends { board: Board; quantity: number }>(
  rows: readonly T[],
): BoardGroup<T>[] {
  return BOARDS.map((board) => {
    const inBoard = rows.filter((row) => row.board === board)
    return {
      board,
      rows: inBoard,
      copies: inBoard.reduce((sum, row) => sum + row.quantity, 0),
    }
  }).filter((group) => group.rows.length > 0)
}

/**
 * Where each group's running numbers start, so the ledger numbering carries
 * on from one board to the next. Counts rows, not copies.
 */
export function boardOffsets(groups: readonly BoardGroup<unknown>[]): number[] {
  let start = 0
  return groups.map((group) => {
    const offset = start
    start += group.rows.length
    return offset
  })
}
