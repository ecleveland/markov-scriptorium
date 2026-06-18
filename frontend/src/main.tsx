import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

// Self-hosted OFL webfonts (VEG-421). Weights chosen to cover the milestone:
// display headings, body + italic, UI labels, and the mono status line.
import '@fontsource/playfair-display/600.css'
import '@fontsource/playfair-display/700.css'
import '@fontsource/spectral/400.css'
import '@fontsource/spectral/400-italic.css'
import '@fontsource/spectral/600.css'
import '@fontsource/mulish/500.css'
import '@fontsource/mulish/600.css'
import '@fontsource/mulish/700.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'

import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
