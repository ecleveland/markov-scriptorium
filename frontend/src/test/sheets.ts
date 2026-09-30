import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Test-only. Two contract tests hold every stylesheet under src/ to one rule:
// focus-ring.test.ts (nobody but index.css draws the ring) and
// components.test.ts (nobody but tokens.css names a colour or a typeface).
// Both need the same walk, so it lives here rather than in either of them.

export interface Sheet {
  /** Path relative to src/, such as `styles/components.css`. */
  name: string
  /** The sheet with its comments stripped, so prose can name what is forbidden. */
  css: string
}

const srcDir = fileURLToPath(new URL('..', import.meta.url))

function cssFilesIn(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return cssFilesIn(path)
    return entry.name.endsWith('.css') ? [path] : []
  })
}

/**
 * Every stylesheet under src/, sorted by name so the generated test titles keep
 * a stable order. `exclude` names the sheets a given contract exempts, by the
 * same relative name the results carry. An exclusion that matches nothing is
 * not an error: the sheet it named is gone, and the contract it was exempt
 * from will say so.
 */
export function cssSheets({ exclude }: { exclude: string[] }): Sheet[] {
  return cssFilesIn(srcDir)
    .map((path) => ({
      name: path.slice(srcDir.length),
      css: readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''),
    }))
    .filter((sheet) => !exclude.includes(sheet.name))
    .sort((a, b) => a.name.localeCompare(b.name))
}
