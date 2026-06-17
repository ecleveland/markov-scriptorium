// Registers jest-dom's custom matchers (toBeInTheDocument, etc.) with Vitest's
// expect, and clears the DOM between tests. Referenced by vite.config.ts's
// `test.setupFiles`.
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
})
