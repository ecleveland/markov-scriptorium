import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import eslintConfigPrettier from 'eslint-config-prettier'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
      eslintConfigPrettier,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    // Non-component modules (api client, hooks): the react-refresh rule only
    // applies to files that export components.
    files: ['**/*.ts'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    // Test files run under Vitest (globals enabled in vite.config.ts).
    files: ['**/*.test.{ts,tsx}', 'src/test/**'],
    languageOptions: {
      globals: globals.vitest,
    },
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
])
