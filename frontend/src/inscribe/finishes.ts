import { FINISHES, type CardPrinting, type Finish } from '../api'

/** Finishes this printing actually exists in (per Scryfall), else nonfoil. */
export function availableFinishes(printing: CardPrinting): Finish[] {
  const offered = FINISHES.filter((finish) =>
    printing.finishes?.includes(finish),
  )
  return offered.length > 0 ? offered : ['nonfoil']
}
