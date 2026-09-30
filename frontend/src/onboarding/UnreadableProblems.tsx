import { Panel } from '../components'

/** One line or row the parser could not read, flattened from either flow. */
export interface Problem {
  number: number
  reason: string
  text: string
}

interface Props {
  /** Names the aside and its heading: "Unreadable lines" or "Unreadable rows". */
  label: string
  /** What one entry is called in this flow: "Line" or "Row". */
  noun: string
  problems: Problem[]
}

/**
 * What the parser could not read, shown on both steps of both importers.
 * Nothing is ever dropped silently (VEG-414, VEG-415). The decklist and CSV
 * flows number their entries differently, so each maps its own problems to
 * `Problem` at the call site.
 */
export function UnreadableProblems({ label, noun, problems }: Props) {
  if (problems.length === 0) return null
  return (
    <Panel as="aside" className="decklist__problems" aria-label={label}>
      <h2>{label}</h2>
      <ul>
        {problems.map((problem) => (
          <li key={problem.number}>
            {noun} {problem.number}: {problem.reason} — “{problem.text}”
          </li>
        ))}
      </ul>
    </Panel>
  )
}
