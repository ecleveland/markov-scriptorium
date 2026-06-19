import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// Test (Vitest) configuration lives in vitest.config.ts so this file stays a
// clean Vite 8 config — Vitest bundles a different Vite version, and mixing the
// two `test`-field types here breaks `tsc -b`.
export default defineConfig({
  plugins: [react()],
  server: {
    // Fail loudly if :5173 is taken rather than silently moving to :5174 — the
    // Playwright e2e harness waits on a fixed port (see playwright.config.ts).
    strictPort: true,
    proxy: {
      // Forward API calls to the FastAPI backend during development.
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
