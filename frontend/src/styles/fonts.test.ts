// @vitest-environment node
import { existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The self-hosted fonts are committed binaries (VEG-620, ADR 0030), produced
// by scripts/subset-fonts.sh. The file list comes from the url() of each face
// in fonts.css, so a renamed font cannot leave this check behind.
// components.test.ts checks each file exists; this one catches a file
// committed empty, as a Git LFS pointer or a failed download would be. Neither
// parses the fonts.

const fontsCss = new URL('./fonts.css', import.meta.url)
const sources = Array.from(
  readFileSync(fileURLToPath(fontsCss), 'utf8').matchAll(/url\('([^']+)'\)/g),
  (m) => m[1],
)

function fontAsset(name: string): string {
  return fileURLToPath(new URL(`../assets/fonts/${name}`, import.meta.url))
}

describe('self-hosted font files', () => {
  it('finds a source for each of the four faces', () => {
    expect(sources).toHaveLength(4)
  })

  it.each(sources)('ships %s at more than 10 KB', (source) => {
    const path = fileURLToPath(new URL(source, fontsCss))
    expect(statSync(path).size).toBeGreaterThan(10 * 1024)
  })

  it.each(['OFL-cormorant-garamond.txt', 'OFL-eb-garamond.txt'])(
    'ships the licence %s beside the fonts',
    (name) => {
      expect(existsSync(fontAsset(name)), `${name} is missing`).toBe(true)
    },
  )
})
