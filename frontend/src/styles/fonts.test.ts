// @vitest-environment node
import { existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The self-hosted fonts are committed binaries (VEG-620, ADR 0030), produced
// by scripts/subset-fonts.sh. These checks catch a file that went missing or
// was committed empty, as a Git LFS pointer or a failed download would be.
// They do not parse the fonts.

function fontAsset(name: string): string {
  return fileURLToPath(new URL(`../assets/fonts/${name}`, import.meta.url))
}

describe('self-hosted font files', () => {
  it.each([
    'cormorant-garamond.woff2',
    'cormorant-garamond-italic.woff2',
    'eb-garamond.woff2',
    'eb-garamond-italic.woff2',
  ])('ships %s at more than 10 KB', (name) => {
    expect(existsSync(fontAsset(name)), `${name} is missing`).toBe(true)
    expect(statSync(fontAsset(name)).size).toBeGreaterThan(10 * 1024)
  })

  it.each(['OFL-cormorant-garamond.txt', 'OFL-eb-garamond.txt'])(
    'ships the licence %s beside the fonts',
    (name) => {
      expect(existsSync(fontAsset(name)), `${name} is missing`).toBe(true)
    },
  )
})
