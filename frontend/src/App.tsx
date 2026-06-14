import { useEffect, useState } from 'react'
import './App.css'

interface Health {
  status: string
  database: string
}

type State = 'pending' | 'ok' | 'error'

function App() {
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
    <main className="scriptorium">
      <h1>The Markov Scriptorium</h1>
      <p className="tagline">A candlelit catalog of the collection.</p>
      <p className="status" data-state={state}>
        Backend: {label}
      </p>
    </main>
  )
}

export default App
