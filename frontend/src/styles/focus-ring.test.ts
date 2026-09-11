// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The focus ring is drawn exactly once, by index.css, which sets `outline` on
// :focus-visible (ADR 0017). Every other stylesheet must leave outlines alone
// and must not reuse the ring token in some other property, or keyboard focus
// silently disappears on that page. This walks every sheet under src/.

const srcDir = fileURLToPath(new URL('..', import.meta.url))

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return cssFiles(path)
    return entry.name.endsWith('.css') ? [path] : []
  })
}

const sheets = cssFiles(srcDir)
  .filter((path) => !path.endsWith('/index.css'))
  .map((path) => ({
    name: path.slice(srcDir.length),
    css: readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''),
  }))

describe('focus ring ownership', () => {
  it('finds the page and component sheets', () => {
    expect(sheets.map((s) => s.name)).toContain('styles/components.css')
    expect(sheets.length).toBeGreaterThan(3)
  })

  it.each(sheets)('$name sets no outline', ({ css }) => {
    expect(css).not.toMatch(/\boutline(-[a-z]+)?\s*:/)
  })

  it.each(sheets)('$name does not repurpose the ring token', ({ css }) => {
    expect(css).not.toMatch(/var\(--focus-ring\)/)
  })
})
