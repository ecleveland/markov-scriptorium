import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'

interface Health {
  status: string
  database: string
}

type State = 'pending' | 'ok' | 'error'

/** A wax-seal brand mark — the house crest pressed into oxblood wax. */
function WaxSeal() {
  return (
    <svg
      className="brand-seal"
      viewBox="0 0 48 48"
      role="img"
      aria-hidden="true"
      focusable="false"
    >
      {/* Scalloped wax blob, then an inscribed ring and an "M" monogram. */}
      <path
        className="brand-seal-wax"
        d="M24 2.5c2.6 0 4.6 2.4 7.1 3 2.6.7 5.7-.3 7.8 1.3 2 1.6 2 4.8 3.5 6.9 1.5 2 4.5 3.2 5.2 5.7.7 2.5-1.1 5.1-1.1 7.6s1.8 5.1 1.1 7.6c-.7 2.5-3.7 3.7-5.2 5.7-1.5 2.1-1.5 5.3-3.5 6.9-2.1 1.6-5.2.6-7.8 1.3-2.5.6-4.5 3-7.1 3s-4.6-2.4-7.1-3c-2.6-.7-5.7.3-7.8-1.3-2-1.6-2-4.8-3.5-6.9-1.5-2-4.5-3.2-5.2-5.7C-.8 32.1 1 29.5 1 27s-1.8-5.1-1.1-7.6c.7-2.5 3.7-3.7 5.2-5.7 1.5-2.1 1.5-5.3 3.5-6.9 2.1-1.6 5.2-.6 7.8-1.3 2.5-.6 4.5-3 7.1-3z"
      />
      <circle className="brand-seal-ring" cx="24" cy="24" r="14.5" />
      <text className="brand-seal-mark" x="24" y="24" dy="0.35em">
        M
      </text>
    </svg>
  )
}

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
        to="/inscribe"
        className="brand"
        aria-label="The Markov Scriptorium — home"
      >
        <WaxSeal />
        <span className="brand-title">
          The Markov <span className="brand-title-accent">Scriptorium</span>
        </span>
      </NavLink>

      <div className="scriptorium-header-end">
        <nav className="scriptorium-nav" aria-label="Primary">
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
