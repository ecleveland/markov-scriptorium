// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { cssSheets } from '../test/sheets'

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
      '--rose',
      '--line-strong',
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

  it('pins the values VEG-427 retuned for contrast', () => {
    expect(valueOf('--rose')).toBe('#d9566b')
    expect(valueOf('--faint')).toBe('#8f8477')
    expect(valueOf('--line-strong')).toBe('#6b6376')
  })

  it('defines semantic aliases over the raw palette', () => {
    for (const name of [
      '--surface',
      '--surface-hover',
      '--surface-raised-hover',
      '--border',
      '--border-strong',
      '--accent',
      '--danger',
      '--success',
      '--warning',
      '--focus-ring',
    ]) {
      expect(declares(name), `missing semantic token ${name}`).toBe(true)
    }
  })

  it('shapes the focus ring as an outline value, since index.css draws it with outline', () => {
    expect(valueOf('--focus-ring')).toMatch(/\bsolid\b/)
    expect(valueOf('--focus-ring')).toContain('var(--focus-ring-width)')
    expect(valueOf('--focus-ring')).toContain('var(--focus-ring-color)')
  })

  it('routes semantic aliases through raw palette tokens, not literals', () => {
    expect(valueOf('--surface')).toContain('var(--panel)')
    expect(valueOf('--border')).toContain('var(--line)')
    expect(valueOf('--border-strong')).toContain('var(--line-strong)')
    expect(valueOf('--danger')).toContain('var(--rose)')
    expect(valueOf('--success')).toContain('var(--green)')
    expect(valueOf('--warning')).toContain('var(--gold)')
    // The hover fills derive from the text token so a palette retune carries
    // them along, rather than transcribing bone by hand.
    expect(valueOf('--surface-hover')).toContain('var(--text)')
    expect(valueOf('--surface-raised-hover')).toContain('var(--text)')
    expect(valueOf('--surface-raised-hover')).toContain('var(--surface-raised)')
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

// WCAG 2.x contrast, computed from the hexes in tokens.css (VEG-427). Text
// must reach AA (4.5:1, criterion 1.4.3) on both surfaces it sits on, and the
// line that is a control's only boundary must reach 3:1 (criterion 1.4.11). A
// retune that slips under either fails here instead of in someone's eyes.

/** The hex a token resolves to, following one `var(--x)` hop if needed. */
function hexOf(name: string): string {
  const value = valueOf(name)
  const alias = value && /^var\((--[a-z0-9-]+)\)$/.exec(value)?.[1]
  const hex = alias ? valueOf(alias) : value
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) {
    throw new Error(`${name} does not resolve to a six-digit hex: ${value}`)
  }
  return hex
}

/** Relative luminance of an sRGB hex, per WCAG 2.x. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const channel = parseInt(hex.slice(i, i + 2), 16) / 255
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(hexOf(a)), luminance(hexOf(b))].sort(
    (x, y) => y - x,
  )
  return (light + 0.05) / (dark + 0.05)
}

describe('contrast', () => {
  it('measures luminance at both ends of the scale', () => {
    expect(luminance('#ffffff')).toBeCloseTo(1)
    expect(luminance('#000000')).toBe(0)
  })

  const textTokens = [
    '--text',
    '--muted',
    '--faint',
    '--gold',
    '--green',
    '--rose',
  ]
  const textGrounds = ['--panel', '--surface-raised']
  const textPairs = textTokens.flatMap((fg) =>
    textGrounds.map((bg) => [fg, bg] as const),
  )

  it.each(textPairs)('%s on %s reads at AA as text', (fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5)
  })

  it('reads the primary button label at AA on oxblood', () => {
    expect(contrast('--text', '--oxblood')).toBeGreaterThanOrEqual(4.5)
  })

  it.each(['--panel', '--bg'])(
    'draws the strong line at 3:1 against %s',
    (ground) => {
      expect(contrast('--line-strong', ground)).toBeGreaterThanOrEqual(3)
    },
  )
})

// ADR 0014: the app is dark-only by design. index.css tells the browser so,
// which keeps native widgets and scrollbars dark, and no sheet branches on the
// OS theme, so a light OS setting cannot turn half the app light.
describe('colour scheme', () => {
  const index = readFileSync(
    fileURLToPath(new URL('../index.css', import.meta.url)),
    'utf8',
  )

  it('declares color-scheme: dark in index.css', () => {
    expect(index).toMatch(/color-scheme\s*:\s*dark\s*;/)
  })

  it.each(cssSheets({ exclude: [] }))(
    '$name has no prefers-color-scheme branch',
    ({ css }) => {
      expect(css).not.toMatch(/prefers-color-scheme/)
    },
  )
})
