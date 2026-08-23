import { Navigate, Route, Routes } from 'react-router-dom'
import './App.css'
import { StatusHeader } from './StatusHeader'
import { CatalogPage } from './catalog/CatalogPage'
import { LotDetailPage } from './catalog/LotDetailPage'
import { InscribePage } from './inscribe/InscribePage'
import { CsvImportPage } from './onboarding/CsvImportPage'
import { DecklistPage } from './onboarding/DecklistPage'

function App() {
  return (
    <div className="app">
      <StatusHeader />
      <main className="scriptorium">
        <Routes>
          <Route path="/" element={<Navigate to="/catalog" replace />} />
          <Route path="/catalog" element={<CatalogPage />} />
          <Route path="/catalog/:lotId" element={<LotDetailPage />} />
          <Route path="/inscribe" element={<InscribePage />} />
          <Route path="/import/decklist" element={<DecklistPage />} />
          <Route path="/import/csv" element={<CsvImportPage />} />
        </Routes>
      </main>
    </div>
  )
}

export default App
