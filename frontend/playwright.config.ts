import { defineConfig, devices } from '@playwright/test'

// End-to-end tests for the Scriptorium web app. These drive a REAL browser
// against the Vite dev server, so they catch what jsdom component tests cannot:
// layout, responsive collapse, and full navigation flows.
//
// The backend is NOT booted. Every `/api/**` call is stubbed at the browser
// network layer (see e2e/stubs.ts), keeping the suite hermetic and honouring
// CLAUDE.md's "mock Scryfall — no network calls in tests". The rationale and
// the rejected backend-booting alternative are recorded in
// docs/decisions/0015-e2e-playwright.md.

const PORT = 5173
const baseURL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: './e2e',
  // Fail a `test.only` left in the source on CI; harmless locally.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL,
    // Artefacts for debugging and for attaching before/after evidence to a PR.
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Boot only the frontend; the API is stubbed per-test. Reuse a dev server the
  // developer already has running locally; always start fresh on CI.
  webServer: {
    command: 'npm run dev',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
