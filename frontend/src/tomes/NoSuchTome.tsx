import { Link } from 'react-router-dom'

/** What the editor and the breakdown show for a Tome id that is not there. */
export function NoSuchTome() {
  return (
    <section className="tome">
      <h1>No such Tome</h1>
      <p>
        That Tome is not on the shelf. It may already have been unbound.{' '}
        <Link to="/tomes">Back to the Tomes</Link>.
      </p>
    </section>
  )
}
