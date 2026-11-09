import { Link } from 'react-router-dom'
import { PageHeader } from '../components'

/** The door to the two import flows, a page of its own under Bring in. */
export function BringInPage() {
  return (
    <section className="bring-in">
      <PageHeader title="Bring in a Collection" />
      <ul className="bring-in__ways">
        <li className="bring-in__way">
          <Link to="/import/decklist">Inscribe a Decklist</Link>
          <p>Paste a list of cards, one per line, and review each match.</p>
        </li>
        <li className="bring-in__way">
          <Link to="/import/csv">Import a Collection CSV</Link>
          <p>Upload an export from Manabox, Deckbox, or Archidekt.</p>
        </li>
      </ul>
    </section>
  )
}
