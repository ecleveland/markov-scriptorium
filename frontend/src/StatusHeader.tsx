import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { Seal } from './components'

interface Health {
  status: string
  database: string
}

type State = 'pending' | 'ok' | 'error'

/** App header: the scriptorium brand mark, nav, and a live backend/catalog status. */
export function StatusHeader() {
  const [health, setHealth] = useState<Health | null>(null)
  const [state, setState] = useState<State>('pending')

  useEffect(() => {
    // Proxied to the FastAPI backend's /health in dev (see vite.config.ts).
    fetch('/api/health')
      .then((res) => {
        // A 5xx (backend up, but unhealthy) must not be read as a healthy body.
        if (!res.ok) throw new Error(`health check returned ${res.status}`)
        return res.json() as Promise<Health>
      })
      .then((data) => {
        setHealth(data)
        setState('ok')
      })
      .catch((err) => {
        console.error('Health check failed', err)
        setState('error')
      })
  }, [])

  const label =
    state === 'ok' && health
      ? `catalog ${health.database}`
      : state === 'error'
        ? 'unreachable'
        : 'consulting…'

  return (
    <header className="scriptorium-header">
      <NavLink
        to="/catalog"
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
          <NavLink to="/catalog">Catalog</NavLink>
          <NavLink to="/tomes">Tomes</NavLink>
          <NavLink to="/inscribe">Inscribe</NavLink>
          <NavLink to="/import/decklist">Decklist</NavLink>
          <NavLink to="/import/csv">CSV</NavLink>
        </nav>
        <p className="status" role="status" data-state={state}>
          <span className="status-dot" aria-hidden="true">
            ●
          </span>
          {label}
        </p>
      </div>
    </header>
  )
}
