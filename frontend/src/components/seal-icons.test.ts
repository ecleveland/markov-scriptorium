// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Contract test for the house seal's copies outside React (VEG-621).
//
// The seal is drawn three times. Seal.tsx is the source, scripts/render-icons.mjs
// repeats the full drawing to render the apple-touch-icon, and public/favicon.svg
// is a simpler drawing for 16 px. The script and the favicon cannot read the
// stylesheets, so they write the token colours out as hexes. This test reads
// all of them together, so a changed path or a retuned token fails here
// instead of leaving a stale icon behind.

function read(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
}

const seal = read('./Seal.tsx')
const script = read('../../scripts/render-icons.mjs')
const favicon = read('../../public/favicon.svg')
const tokens = read('../styles/tokens.css')

/** Every `d="..."` path value in a file, sorted so order does not matter. */
function pathData(text: string): string[] {
  return [...text.matchAll(/\bd="([^"]+)"/g)].map((match) => match[1]).sort()
}

/** Every six-digit hex in a file, lowercased, deduplicated and sorted. */
function hexes(text: string): string[] {
  const found = text.match(/#[0-9a-f]{6}\b/gi) ?? []
  return [...new Set(found.map((hex) => hex.toLowerCase()))].sort()
}

/** The value of a `--name: value;` declaration in tokens.css. */
function token(name: string): string {
  const value = new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(tokens)?.[1].trim()
  if (value === undefined)
    throw new Error(`tokens.css does not declare ${name}`)
  return value
}

/** A token that must be a plain six-digit hex, lowercased. */
function hexToken(name: string): string {
  const value = token(name).toLowerCase()
  expect(value, `${name} is not a plain hex`).toMatch(/^#[0-9a-f]{6}$/)
  return value
}

/**
 * Resolve `color-mix(in srgb, var(--a), var(--b) N%)` the way the browser
 * does: N percent of b, the rest of a, rounded per channel.
 */
function mixedToken(name: string): string {
  const match =
    /^color-mix\(in srgb, var\((--[\w-]+)\), var\((--[\w-]+)\) (\d+)%\)$/.exec(
      token(name),
    )
  if (match === null) throw new Error(`${name} is not a two-token srgb mix`)
  const [, first, second, percent] = match
  const weight = Number(percent) / 100
  const channels = (hex: string) =>
    [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16))
  const a = channels(hexToken(first))
  const b = channels(hexToken(second))
  return (
    '#' +
    a
      .map((channel, i) => Math.round(channel * (1 - weight) + b[i] * weight))
      .map((channel) => channel.toString(16).padStart(2, '0'))
      .join('')
  )
}

describe('seal icon contract', () => {
  it('keeps the render script drawing equal to Seal.tsx', () => {
    const drawn = pathData(seal)
    expect(drawn).toHaveLength(5)
    expect(pathData(script)).toEqual(drawn)
  })

  it('pins the render script hexes to the tokens', () => {
    expect(hexes(script)).toEqual(
      [
        hexToken('--oxblood'),
        hexToken('--oxblood-bright'),
        hexToken('--gold'),
        hexToken('--bg'),
        mixedToken('--accent-pressed'),
      ].sort(),
    )
  })

  it('pins the favicon hexes to the tokens', () => {
    expect(hexes(favicon)).toEqual(
      [hexToken('--oxblood'), hexToken('--gold')].sort(),
    )
  })
})
