import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

interface Health {
  status: string
  database: string
}

type State = 'pending' | 'ok' | 'error'

/** App header: the scriptorium title, nav, and a live backend/catalog status. */
export function StatusHeader() {
  const [health, setHealth] = useState<Health | null>(null)
  const [state, setState] = useState<State>('pending')

  useEffect(() => {
    // Proxied to the FastAPI backend's /health in dev (see vite.config.ts).
    fetch('/api/health')
      .then((res) => res.json() as Promise<Health>)
      .then((data) => {
        setHealth(data)
        setState('ok')
      })
      .catch(() => setState('error'))
  }, [])

  const label =
    state === 'ok' && health
      ? `awake · catalog ${health.database}`
      : state === 'error'
        ? 'unreachable'
        : 'consulting the catalog…'

  return (
    <header className="scriptorium-header">
      <h1>
        <Link to="/inscribe">The Markov Scriptorium</Link>
      </h1>
      <p className="status" data-state={state}>
        Backend: {label}
      </p>
    </header>
  )
}
