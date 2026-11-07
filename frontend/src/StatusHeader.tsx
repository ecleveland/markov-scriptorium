import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { Seal } from './components'

interface Health {
  status: string
  database: string
}

interface Status {
  state: 'pending' | 'ok' | 'error'
  sentence: string
}

const PENDING: Status = {
  state: 'pending',
  sentence: 'consulting the catalog…',
}
const OPEN: Status = { state: 'ok', sentence: 'the catalog is open' }
const UNOPENED: Status = {
  state: 'error',
  sentence: 'the catalog could not be opened',
}
const UNREACHED: Status = {
  state: 'error',
  sentence: 'the catalog could not be reached',
}

/** The running head: the brand mark, the nav, and one sentence on the catalog's health. */
export function StatusHeader() {
  const [status, setStatus] = useState<Status>(PENDING)

  useEffect(() => {
    // Proxied to the FastAPI backend's /health in dev (see vite.config.ts).
    fetch('/api/health')
      .then((res) => {
        // A 5xx (backend up, but unhealthy) must not be read as a healthy body.
        if (!res.ok) throw new Error(`health check returned ${res.status}`)
        return res.json() as Promise<Health>
      })
      .then((data) => {
        // The backend can answer while its database cannot.
        setStatus(data.database === 'ok' ? OPEN : UNOPENED)
      })
      .catch((err) => {
        console.error('Health check failed', err)
        setStatus(UNREACHED)
      })
  }, [])

  return (
    <header className="scriptorium-header">
      <NavLink
        to="/index"
        className="brand"
        aria-label="The Markov Scriptorium, home"
      >
        <Seal className="brand-seal" />
        <span className="brand-title">
          The Markov <span className="brand-title-accent">Scriptorium</span>
        </span>
      </NavLink>

      <div className="scriptorium-header-end">
        <nav className="scriptorium-nav" aria-label="Primary">
          <NavLink to="/index">The Index</NavLink>
          <NavLink to="/catalog">The Catalog</NavLink>
          <NavLink to="/tomes">Tomes</NavLink>
          <NavLink to="/inscribe">Inscribe</NavLink>
          <NavLink to="/scan">Scry</NavLink>
          {/* Current on both import pages by NavLink's prefix match. */}
          <NavLink to="/import">Bring in</NavLink>
          <NavLink to="/archive">Muniment Room</NavLink>
        </nav>
        <p className="status" role="status" data-state={status.state}>
          <span className="status-dot" aria-hidden="true" />
          {status.sentence}
        </p>
      </div>
    </header>
  )
}
