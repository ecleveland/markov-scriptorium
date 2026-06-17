import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Separate from vite.config.ts on purpose: Vitest bundles its own Vite version,
// so its `test`-field types only apply here. This file is intentionally not in
// any tsconfig `include`, so `tsc -b` never type-checks the cross-Vite types.
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: false,
  },
})
