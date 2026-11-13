/**
 * The finish after a card's name, in gold small caps: "foil" or "etched".
 * A nonfoil folio is the plain case and says nothing. The leading space
 * belongs to the caller, so nothing dangles when this renders null.
 */
export function FinishWord({ finish }: { finish: string }) {
  if (finish !== 'foil' && finish !== 'etched') return null
  return <span className="finish-word">{finish}</span>
}
