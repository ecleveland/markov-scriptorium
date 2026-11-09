import { Suspense, lazy, type ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import './App.css'
import { StatusHeader } from './StatusHeader'
import { ArchivePage } from './archive/ArchivePage'
import { Consulting } from './components'
import { CatalogPage } from './catalog/CatalogPage'
import { LotDetailPage } from './catalog/LotDetailPage'
import { IndexPage } from './index/IndexPage'
import { PrintingPage } from './index/PrintingPage'
import { InscribePage } from './inscribe/InscribePage'
import { BreakdownPage } from './tomes/BreakdownPage'
import { TomeEditorPage } from './tomes/TomeEditorPage'
import { TomesPage } from './tomes/TomesPage'
import { BringInPage } from './onboarding/BringInPage'
import { CsvImportPage } from './onboarding/CsvImportPage'
import { DecklistPage } from './onboarding/DecklistPage'
import { ScanPage } from './scan/ScanPage'

// The component specimen sheet exists in development only. The conditional
// dynamic import lets the production build drop both its chunk and its CSS.
const Specimens = import.meta.env.DEV
  ? lazy(() =>
      import('./specimens/Specimens').then((m) => ({ default: m.Specimens })),
    )
  : null

interface LeafProps {
  /** The page's folio number in nav order. The specimen sheet has none. */
  folio?: number
  /** The small-caps title in the margin, naming the page's place in the book. */
  running: string
  children: ReactNode
}

/**
 * One leaf of the book: the margin column with the folio mark and running
 * title, then the page in the text column. The margin is ornament and the
 * page's own heading names the page, so assistive tech skips it.
 */
function Leaf({ folio, running, children }: LeafProps) {
  return (
    <>
      <div className="leaf__margin" aria-hidden="true">
        {folio !== undefined && (
          <span className="leaf__folio">fol. {folio}</span>
        )}
        <span className="leaf__running">{running}</span>
      </div>
      {children}
    </>
  )
}

function App() {
  return (
    <div className="app">
      <StatusHeader />
      <main className="scriptorium">
        <Routes>
          <Route path="/" element={<Navigate to="/index" replace />} />
          <Route
            path="/index"
            element={
              <Leaf folio={1} running="The Catalog, searched">
                <IndexPage />
              </Leaf>
            }
          />
          <Route
            path="/index/:scryfallId"
            element={
              <Leaf folio={1} running="The Catalog, searched">
                <PrintingPage />
              </Leaf>
            }
          />
          <Route
            path="/catalog"
            element={
              <Leaf folio={2} running="The Catalog">
                <CatalogPage />
              </Leaf>
            }
          />
          <Route
            path="/catalog/:lotId"
            element={
              <Leaf folio={2} running="The Catalog">
                <LotDetailPage />
              </Leaf>
            }
          />
          <Route
            path="/tomes"
            element={
              <Leaf folio={3} running="The Bindery">
                <TomesPage />
              </Leaf>
            }
          />
          <Route
            path="/tomes/:deckId"
            element={
              <Leaf folio={3} running="The Bindery">
                <TomeEditorPage />
              </Leaf>
            }
          />
          <Route
            path="/tomes/:deckId/breakdown"
            element={
              <Leaf folio={3} running="Owned and needed">
                <BreakdownPage />
              </Leaf>
            }
          />
          <Route
            path="/inscribe"
            element={
              <Leaf folio={4} running="Inscription">
                <InscribePage />
              </Leaf>
            }
          />
          <Route
            path="/scan"
            element={
              <Leaf folio={5} running="The Scrying Glass">
                <ScanPage />
              </Leaf>
            }
          />
          <Route
            path="/import"
            element={
              <Leaf folio={6} running="Bring in">
                <BringInPage />
              </Leaf>
            }
          />
          <Route
            path="/import/decklist"
            element={
              <Leaf folio={6} running="Decklist import">
                <DecklistPage />
              </Leaf>
            }
          />
          <Route
            path="/import/csv"
            element={
              <Leaf folio={6} running="CSV import">
                <CsvImportPage />
              </Leaf>
            }
          />
          <Route
            path="/archive"
            element={
              <Leaf folio={7} running="Safekeeping">
                <ArchivePage />
              </Leaf>
            }
          />
          {Specimens && (
            <Route
              path="/specimens"
              element={
                <Leaf running="Specimens">
                  <Suspense
                    fallback={
                      <Consulting>Laying out the specimens…</Consulting>
                    }
                  >
                    <Specimens />
                  </Suspense>
                </Leaf>
              }
            />
          )}
        </Routes>
      </main>
    </div>
  )
}

export default App
