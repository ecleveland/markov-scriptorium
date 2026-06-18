// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Contract test for the design-token foundation (VEG-421).
//
// jsdom does not apply external stylesheets, so we cannot assert computed
// styles. Instead we treat tokens.css as a contract the rest of the M3.7
// milestone inherits: every token below must exist, and the palette values
// fixed by the ticket must not drift. This guards against a token being
// renamed or deleted out from under a consumer in a later restyle ticket.

const tokens = readFileSync(
  fileURLToPath(new URL('./tokens.css', import.meta.url)),
  'utf8',
)

/** Match `--name:` declarations regardless of surrounding whitespace. */
function declares(name: string): boolean {
  return new RegExp(`${name}\\s*:`).test(tokens)
}

/** Extract the value of a `--name: value;` declaration, trimmed. */
function valueOf(name: string): string | undefined {
  return new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(tokens)?.[1].trim()
}

describe('design tokens contract', () => {
  it('defines the raw palette the milestone inherits', () => {
    for (const name of [
      '--bg',
      '--panel',
      '--line',
      '--oxblood',
      '--oxblood-bright',
      '--gold',
      '--green',
      '--text',
      '--muted',
      '--faint',
    ]) {
      expect(declares(name), `missing raw token ${name}`).toBe(true)
    }
  })

  it('pins the palette values fixed by the ticket spec', () => {
    expect(valueOf('--bg')).toBe('#0e0c10')
    expect(valueOf('--panel')).toBe('#16131b')
    expect(valueOf('--oxblood')).toBe('#8f1d2b')
    expect(valueOf('--oxblood-bright')).toBe('#c0394e')
    expect(valueOf('--gold')).toBe('#b3925b')
    expect(valueOf('--text')).toBe('#ece5d8')
  })

  it('defines semantic aliases over the raw palette', () => {
    for (const name of [
      '--surface',
      '--border',
      '--accent',
      '--danger',
      '--success',
      '--focus-ring',
    ]) {
      expect(declares(name), `missing semantic token ${name}`).toBe(true)
    }
  })

  it('routes semantic aliases through raw palette tokens, not literals', () => {
    expect(valueOf('--surface')).toContain('var(--panel)')
    expect(valueOf('--border')).toContain('var(--line)')
    expect(valueOf('--success')).toContain('var(--green)')
  })

  it('defines the four type-family tokens', () => {
    for (const name of [
      '--font-display',
      '--font-body',
      '--font-sans',
      '--font-mono',
    ]) {
      expect(declares(name), `missing font token ${name}`).toBe(true)
    }
  })

  it('defines type, spacing, radius, and elevation scales', () => {
    for (const name of [
      '--text-base',
      '--text-3xl',
      '--leading-normal',
      '--space-1',
      '--space-6',
      '--radius-md',
      '--elevation-2',
    ]) {
      expect(declares(name), `missing scale token ${name}`).toBe(true)
    }
  })
})
