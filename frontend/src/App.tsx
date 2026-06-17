import { Navigate, Route, Routes } from 'react-router-dom'
import './App.css'
import { StatusHeader } from './StatusHeader'
import { InscribePage } from './inscribe/InscribePage'

function App() {
  return (
    <div className="app">
      <StatusHeader />
      <main className="scriptorium">
        <Routes>
          <Route path="/" element={<Navigate to="/inscribe" replace />} />
          <Route path="/inscribe" element={<InscribePage />} />
        </Routes>
      </main>
    </div>
  )
}

export default App
