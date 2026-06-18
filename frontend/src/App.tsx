import { Navigate, Route, Routes } from 'react-router-dom'
import './App.css'
import { StatusHeader } from './StatusHeader'
import { InscribePage } from './inscribe/InscribePage'
import { DecklistPage } from './onboarding/DecklistPage'

function App() {
  return (
    <div className="app">
      <StatusHeader />
      <main className="scriptorium">
        <Routes>
          <Route path="/" element={<Navigate to="/inscribe" replace />} />
          <Route path="/inscribe" element={<InscribePage />} />
          <Route path="/import/decklist" element={<DecklistPage />} />
        </Routes>
      </main>
    </div>
  )
}

export default App
