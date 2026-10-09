// Query keys for everything read about Tomes. All of them nest under
// `tomeKeys.all`, so one invalidation after a write refreshes the list, the open
// Tome, and its breakdown together.

export const tomeKeys = {
  all: ['tomes'] as const,
  list: () => ['tomes', 'list'] as const,
  tome: (deckId: number) => ['tomes', 'tome', deckId] as const,
  breakdown: (deckId: number) => ['tomes', 'breakdown', deckId] as const,
}
