import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  render,
  type RenderOptions,
  type RenderResult,
} from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'

// Test-side counterpart of the QueryClientProvider in main.tsx. Every test gets
// its own client so no cache leaks between cases, and retries are off so a
// rejected query surfaces its error state immediately instead of after backoff.

export function testQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
}

/** Render `ui` inside a fresh QueryClientProvider. */
export function renderWithQuery(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>,
): RenderResult {
  const client = testQueryClient()
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return render(ui, { wrapper: Wrapper, ...options })
}
