import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import './App.css'
import { StatusHeader } from './StatusHeader'
import { Consulting } from './components'
import { CatalogPage } from './catalog/CatalogPage'
import { LotDetailPage } from './catalog/LotDetailPage'
import { InscribePage } from './inscribe/InscribePage'
import { BreakdownPage } from './tomes/BreakdownPage'
import { TomeEditorPage } from './tomes/TomeEditorPage'
import { TomesPage } from './tomes/TomesPage'
import { CsvImportPage } from './onboarding/CsvImportPage'
import { DecklistPage } from './onboarding/DecklistPage'

// The component specimen sheet exists in development only. The conditional
// dynamic import lets the production build drop both its chunk and its CSS.
const Specimens = import.meta.env.DEV
  ? lazy(() =>
      import('./specimens/Specimens').then((m) => ({ default: m.Specimens })),
    )
  : null

function App() {
  return (
    <div className="app">
      <StatusHeader />
      <main className="scriptorium">
        <Routes>
          <Route path="/" element={<Navigate to="/catalog" replace />} />
          <Route path="/catalog" element={<CatalogPage />} />
          <Route path="/catalog/:lotId" element={<LotDetailPage />} />
          <Route path="/tomes" element={<TomesPage />} />
          <Route path="/tomes/:deckId" element={<TomeEditorPage />} />
          <Route path="/tomes/:deckId/breakdown" element={<BreakdownPage />} />
          <Route path="/inscribe" element={<InscribePage />} />
          <Route path="/import/decklist" element={<DecklistPage />} />
          <Route path="/import/csv" element={<CsvImportPage />} />
          {Specimens && (
            <Route
              path="/specimens"
              element={
                <Suspense
                  fallback={<Consulting>Laying out the specimens…</Consulting>}
                >
                  <Specimens />
                </Suspense>
              }
            />
          )}
        </Routes>
      </main>
    </div>
  )
}

export default App
