// @vitest-environment node
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { cssSheets } from '../test/sheets'

// Contract tests for the stylesheets (VEG-423, VEG-424, ADR 0017).
//
// Two contracts live here. The first is the component layer's own: how .btn
// drives its fills, how hover is guarded, and which block classes must exist.
// The second is the tokens-only rule, which every sheet answers to, not just
// components.css: no raw colours and no font names outside tokens.css, so a
// later re-theme is a tokens.css edit and nothing else. (focus-ring.test.ts
// separately guarantees no sheet sets `outline`; box-shadow stays free for
// elevation.)

/** Every CSS named colour. A value token matching one of these is a raw colour. */
const NAMED_COLOURS = new Set([
  'aliceblue',
  'antiquewhite',
  'aqua',
  'aquamarine',
  'azure',
  'beige',
  'bisque',
  'black',
  'blanchedalmond',
  'blue',
  'blueviolet',
  'brown',
  'burlywood',
  'cadetblue',
  'chartreuse',
  'chocolate',
  'coral',
  'cornflowerblue',
  'cornsilk',
  'crimson',
  'cyan',
  'darkblue',
  'darkcyan',
  'darkgoldenrod',
  'darkgray',
  'darkgreen',
  'darkgrey',
  'darkkhaki',
  'darkmagenta',
  'darkolivegreen',
  'darkorange',
  'darkorchid',
  'darkred',
  'darksalmon',
  'darkseagreen',
  'darkslateblue',
  'darkslategray',
  'darkslategrey',
  'darkturquoise',
  'darkviolet',
  'deeppink',
  'deepskyblue',
  'dimgray',
  'dimgrey',
  'dodgerblue',
  'firebrick',
  'floralwhite',
  'forestgreen',
  'fuchsia',
  'gainsboro',
  'ghostwhite',
  'gold',
  'goldenrod',
  'gray',
  'green',
  'greenyellow',
  'grey',
  'honeydew',
  'hotpink',
  'indianred',
  'indigo',
  'ivory',
  'khaki',
  'lavender',
  'lavenderblush',
  'lawngreen',
  'lemonchiffon',
  'lightblue',
  'lightcoral',
  'lightcyan',
  'lightgoldenrodyellow',
  'lightgray',
  'lightgreen',
  'lightgrey',
  'lightpink',
  'lightsalmon',
  'lightseagreen',
  'lightskyblue',
  'lightslategray',
  'lightslategrey',
  'lightsteelblue',
  'lightyellow',
  'lime',
  'limegreen',
  'linen',
  'magenta',
  'maroon',
  'mediumaquamarine',
  'mediumblue',
  'mediumorchid',
  'mediumpurple',
  'mediumseagreen',
  'mediumslateblue',
  'mediumspringgreen',
  'mediumturquoise',
  'mediumvioletred',
  'midnightblue',
  'mintcream',
  'mistyrose',
  'moccasin',
  'navajowhite',
  'navy',
  'oldlace',
  'olive',
  'olivedrab',
  'orange',
  'orangered',
  'orchid',
  'palegoldenrod',
  'palegreen',
  'paleturquoise',
  'palevioletred',
  'papayawhip',
  'peachpuff',
  'peru',
  'pink',
  'plum',
  'powderblue',
  'purple',
  'rebeccapurple',
  'red',
  'rosybrown',
  'royalblue',
  'saddlebrown',
  'salmon',
  'sandybrown',
  'seagreen',
  'seashell',
  'sienna',
  'silver',
  'skyblue',
  'slateblue',
  'slategray',
  'slategrey',
  'snow',
  'springgreen',
  'steelblue',
  'tan',
  'teal',
  'thistle',
  'tomato',
  'turquoise',
  'violet',
  'wheat',
  'white',
  'whitesmoke',
  'yellow',
  'yellowgreen',
])

/**
 * tokens.css is the one sheet allowed to name a colour or a typeface, apart
 * from fonts.css, whose @font-face rules must name the families they declare.
 * fonts.css holds nothing but those rules, so leaving it out of the colour and
 * motion contracts costs nothing; its own contract is below.
 */
const sheets = cssSheets({
  exclude: ['styles/tokens.css', 'styles/fonts.css'],
})

const tokensSheet = cssSheets({ exclude: [] }).find(
  (sheet) => sheet.name === 'styles/tokens.css',
)
if (!tokensSheet) {
  throw new Error('styles/tokens.css was not found under src/')
}

/** Every custom property a sheet declares, as `--name`. */
function declaredProperties(css: string): Set<string> {
  return new Set(Array.from(css.matchAll(/(--[a-z0-9-]+)\s*:/gi), (m) => m[1]))
}

const tokenNames = declaredProperties(tokensSheet.css)

/**
 * Properties a component sets on its own element so a page can retheme it
 * (ADR 0017). Any sheet may read or set them without declaring them first.
 */
const ELEMENT_PROPERTIES = new Set([
  '--btn-bg',
  '--btn-bg-hover',
  '--btn-border',
  '--btn-border-hover',
])

/**
 * The `var(--name)` references in a sheet, with or without a fallback, that
 * neither tokens.css, the sheet itself, nor a component's element properties
 * declare. A token renamed or deleted under a consumer shows up here, where
 * the browser would drop the declaration without a word.
 */
function undeclaredReferences(css: string): string[] {
  const own = declaredProperties(css)
  const references = Array.from(
    css.matchAll(/var\(\s*(--[a-z0-9-]+)/gi),
    (m) => m[1],
  )
  return [...new Set(references)].filter(
    (name) =>
      !tokenNames.has(name) && !own.has(name) && !ELEMENT_PROPERTIES.has(name),
  )
}

/**
 * A font family written into a sheet: a `font-family` that is not a token, or
 * a `font` shorthand naming a quoted family or a well-known one. `font:
 * inherit` passes.
 */
function namesRawFont(css: string): boolean {
  return (
    /font-family\s*:(?!\s*var\()/.test(css) ||
    /(?<![\w-])font\s*:[^;}]*(['"]|\b(serif|sans-serif|monospace|cursive|fantasy|system-ui|Georgia|Palatino)\b)/i.test(
      css,
    )
  )
}

/**
 * VEG-620: labels and headers ask for small caps, never a case transform, and
 * the variant settings come only from the tokens, so a later retune is one
 * edit in tokens.css. The shorthand and raw feature settings would get around
 * both, so they are out too.
 */
const OFF_TOKEN_TYPOGRAPHY = [
  /text-transform\s*:\s*(uppercase|capitalize)/i,
  /font-variant\s*:/i,
  /font-feature-settings\s*:/i,
  /font-variant-caps\s*:(?!\s*var\(--caps\)\s*[;}])/i,
  /font-variant-numeric\s*:(?!\s*var\(--figures\)\s*[;}])/i,
]

function setsTypographyOffToken(css: string): boolean {
  return OFF_TOKEN_TYPOGRAPHY.some((rule) => rule.test(css))
}

const componentSheet = sheets.find(
  (sheet) => sheet.name === 'styles/components.css',
)
if (!componentSheet) {
  // The describe below has nothing to assert against, and a silently empty
  // contract is worse than a red file.
  throw new Error('styles/components.css was not found under src/')
}
const declarations = componentSheet.css

/**
 * Split a sheet into the text inside `@media (prefers-reduced-motion:
 * no-preference)` blocks and the text outside them, by matching braces from
 * each such block's opening brace to its close.
 */
function splitReducedMotionBlocks(css: string): {
  inside: string
  outside: string
} {
  // No comma anywhere in the prelude: `@media screen, (prefers-reduced-motion:
  // no-preference)` is a media query list, and its first query matches with
  // reduced motion on, so its contents are not opt-in.
  const opener =
    /@media[^{,]*prefers-reduced-motion\s*:\s*no-preference[^{,]*\{/g
  let inside = ''
  let outside = ''
  let cursor = 0
  for (let match = opener.exec(css); match; match = opener.exec(css)) {
    outside += css.slice(cursor, match.index)
    let depth = 1
    let i = match.index + match[0].length
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++
      else if (css[i] === '}') depth--
      i++
    }
    inside += css.slice(match.index + match[0].length, i - 1)
    cursor = i
    opener.lastIndex = i
  }
  outside += css.slice(cursor)
  return { inside, outside }
}

describe('reduced-motion block splitter', () => {
  it('separates the media block from the rest of the sheet', () => {
    const { inside, outside } = splitReducedMotionBlocks(`
      .a { animation: x 1s; }
      @media (prefers-reduced-motion: no-preference) {
        .b { animation: y 1s; }
      }
      .c { color: var(--text); }
    `)
    expect(inside).toContain('.b { animation: y 1s; }')
    expect(outside).toContain('.a { animation: x 1s; }')
    expect(outside).toContain('.c {')
    expect(outside).not.toContain('.b')
  })

  it('counts a media query list with another query as outside', () => {
    const { inside, outside } = splitReducedMotionBlocks(`
      @media screen, (prefers-reduced-motion: no-preference) {
        .b { animation: y 1s; }
      }
    `)
    expect(inside).toBe('')
    expect(outside).toContain('.b { animation: y 1s; }')
  })
})

describe('stylesheet contract checks', () => {
  it('flags a reference to a custom property nothing declares', () => {
    expect(
      undeclaredReferences('.status { font-family: var(--font-mono); }'),
    ).toEqual(['--font-mono'])
    expect(
      undeclaredReferences('.a { color: var(--gone, var(--text)); }'),
    ).toEqual(['--gone'])
    expect(
      undeclaredReferences(
        '.a { --local: 1px; margin: var(--local); color: var(--text); background: var(--btn-bg); }',
      ),
    ).toEqual([])
  })

  it('catches a family named through the font shorthand', () => {
    expect(namesRawFont(".a { font-family: 'EB Garamond'; }")).toBe(true)
    expect(namesRawFont(".a { font: 500 1rem 'EB Garamond'; }")).toBe(true)
    expect(namesRawFont('.a { font: italic 1rem/1.2 Georgia, serif; }')).toBe(
      true,
    )
    expect(namesRawFont('.a { font: inherit; }')).toBe(false)
    expect(namesRawFont('.a { font-family: var(--font-body); }')).toBe(false)
  })

  it('catches every way around the typography tokens', () => {
    for (const css of [
      '.a { text-transform: Uppercase; }',
      '.a { text-transform: capitalize; }',
      '.a { font-variant: small-caps; }',
      '.a { font-feature-settings: "smcp"; }',
      '.a { font-variant-caps: all-small-caps; }',
      '.a { font-variant-numeric: lining-nums; }',
      '.a { font-variant-numeric: var(--figures) slashed-zero; }',
    ]) {
      expect(setsTypographyOffToken(css), css).toBe(true)
    }
    expect(
      setsTypographyOffToken(
        '.a { font-variant-caps: var(--caps); font-variant-numeric: var(--figures) }',
      ),
    ).toBe(false)
  })
})

describe('stylesheet contract (every sheet)', () => {
  it('finds the component sheet and every page sheet', () => {
    expect(sheets.map((sheet) => sheet.name)).toEqual(
      expect.arrayContaining([
        'styles/components.css',
        'App.css',
        'catalog/catalog.css',
        'inscribe/inscribe.css',
        'onboarding/decklist.css',
        'specimens/specimens.css',
      ]),
    )
    expect(sheets.length).toBeGreaterThan(5)
  })

  it.each(sheets)('$name uses no raw colour values', ({ css }) => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i)
    expect(css).not.toMatch(/\b(rgba?|hsla?|color-mix)\(/)
    // Named colours anywhere in a value, including shorthands like
    // `1px solid red`. Token references and property names are stripped
    // first so `--gold` and `white-space` do not trip it.
    const values = (css.match(/\{[^}]*\}/g) ?? []) // blocks only, no selectors
      .join('\n')
      .toLowerCase() // CSS keywords are case-insensitive
      .replace(/var\(--[a-z0-9-]+(,[^)]*)?\)/g, '') // token refs, with fallbacks
      .replace(/^\s*[a-z-]+\s*:/gm, ':')
    const words = values.match(/[a-z]+/g) ?? []
    expect(words.filter((w) => NAMED_COLOURS.has(w))).toEqual([])
  })

  it.each(sheets)('$name uses no raw font family names', ({ css }) => {
    expect(namesRawFont(css)).toBe(false)
  })

  it.each(sheets)(
    '$name sets case, small caps and figures only through the tokens',
    ({ css }) => {
      const offenders = OFF_TOKEN_TYPOGRAPHY.filter((rule) => rule.test(css))
      expect(offenders).toEqual([])
    },
  )

  it.each(sheets)(
    '$name references only declared custom properties',
    ({ css }) => {
      expect(undeclaredReferences(css)).toEqual([])
    },
  )

  // Motion plays only for people who have not asked the OS to reduce it, so
  // the default is still. Since VEG-427 that covers the 120ms hover
  // transitions as well as keyframed animation.
  it.each(sheets)('$name keeps motion opt-in by media query', ({ css }) => {
    const { outside } = splitReducedMotionBlocks(css)
    expect(outside).not.toMatch(
      /\b(animation(-name)?|transition(-property|-duration)?)\s*:/,
    )
  })
})

describe('component stylesheet contract', () => {
  it('guards hover on disableable controls with :where() so page overrides keep winning', () => {
    // A bare `:not(:disabled)` or `:enabled` would lift the rule to (0,3,0),
    // beating any page rule written at the natural (0,2,0). ADR 0017 promises
    // pages never need !important, so the guard must be specificity-free.
    // Only buttons and form controls can be disabled; other hover rules need
    // no guard at all.
    const selectorLists = declarations.match(/[^{}]*:hover[^{]*/g) ?? []
    const hovers = selectorLists
      .flatMap((list) => list.split(','))
      .map((selector) => selector.trim())
      .filter((selector) => !selector.startsWith('@')) // media preludes
      .filter((selector) =>
        /^\.(btn|control|listbox__option)\b.*:hover/.test(selector),
      )
    expect(hovers.length).toBeGreaterThan(0)
    for (const selector of hovers) {
      expect(selector).toMatch(/:hover:where\(:not\(:disabled\)\)$/)
    }
  })

  it('drives button fills through per-variant custom properties', () => {
    // Pages retheme a button by setting --btn-bg / --btn-bg-hover, not by
    // fighting the hover rule, so the base rule must read them.
    expect(declarations).toMatch(
      /\.btn\s*\{[^}]*background-color:\s*var\(--btn-bg\)/,
    )
    expect(declarations).toMatch(
      /\.btn:hover:where\(:not\(:disabled\)\)\s*\{[^}]*background-color:\s*var\(--btn-bg-hover\)/,
    )
  })

  it('keeps every button label at AA on hover', () => {
    // Bone on oxblood-bright is 4.26:1 and rose on the bone hover fill is 3.7
    // to 4.4:1 (tokens.test.ts measures both). So the primary fill darkens to
    // the pressed accent, and the danger label turns bone while its rose border
    // stays as the cue.
    expect(declarations).toMatch(
      /\.btn--primary\s*\{[^}]*--btn-bg-hover:\s*var\(--accent-pressed\)/,
    )
    expect(declarations).toMatch(
      /\.btn--danger:hover:where\(:not\(:disabled\)\)\s*\{[^}]*color:\s*var\(--text-primary\)/,
    )
  })

  it('plays the seal press, the candle flicker, and the hover fades only under the media query', () => {
    const { inside } = splitReducedMotionBlocks(declarations)
    for (const block of ['.btn', '.listbox__option', '.control']) {
      expect(inside, `${block} transition`).toMatch(
        new RegExp(`\\${block}\\s*\\{[^}]*transition:`),
      )
    }
    expect(inside).toMatch(/\.sealed__seal\s*\{[^}]*animation:\s*seal-press\b/)
    expect(inside).toMatch(
      /\.consulting__candle\s*\{[^}]*animation:\s*candle-flicker\b/,
    )
    expect(declarations).toMatch(/@keyframes seal-press\s*\{/)
    expect(declarations).toMatch(/@keyframes candle-flicker\s*\{/)
  })

  it('declares the block class for every component', () => {
    for (const block of [
      '.btn',
      '.tag',
      '.panel',
      '.field',
      '.control',
      '.printing-chip',
      '.page-header',
      '.notice',
      '.listbox',
      '.seal',
      '.sealed',
      '.empty-state',
      '.consulting',
      '.notice--inline',
      '.rubric',
    ]) {
      expect(declarations, `missing ${block}`).toContain(`${block} {`)
    }
  })
})

// The status candle has three states. Reduced motion stops the pending
// flicker, so pending needs a look of its own that is not motion.
describe('status candle', () => {
  const app = sheets.find((sheet) => sheet.name === 'App.css')
  const pending = /\.status\[data-state='pending'\] \.status-dot\s*\{([^}]*)\}/

  it('dims the pending candle without motion', () => {
    const { outside } = splitReducedMotionBlocks(app?.css ?? '')
    const rule = outside.match(pending)?.[1] ?? ''
    expect(rule).toMatch(/box-shadow:\s*none/)
    expect(rule).toMatch(/opacity:/)
  })

  it('flickers the pending candle only under the media query', () => {
    const { inside, outside } = splitReducedMotionBlocks(app?.css ?? '')
    expect(inside).toMatch(/animation:\s*candle-flicker\b/)
    expect(outside).not.toMatch(/candle-flicker/)
  })
})

// The Catalog's Card cell is a <td>. Giving a cell a flex or grid display
// takes it out of table layout, so it stops stretching to the row height and
// its bottom border floats above the row's. Keep every table cell a cell.
describe('catalog table cells', () => {
  const catalog = sheets.find((sheet) => sheet.name === 'catalog/catalog.css')
  const cellClasses = ['.catalog__art', '.catalog__card', '.catalog__quantity']

  it.each(cellClasses)('%s does not leave table layout', (cls) => {
    const block = catalog?.css.match(
      new RegExp(`${cls.replace('.', '\\.')}\\s*\\{([^}]*)\\}`),
    )
    expect(block?.[1] ?? '').not.toMatch(/display\s*:/)
  })
})

// VEG-620, ADR 0030: the self-hosted variable Garamonds. One face per family
// and style, each spanning its weight axis, so every weight the sheets ask for
// comes from the file rather than the browser's synthesis.
describe('font-face sheet contract', () => {
  const fontsSheet = cssSheets({ exclude: [] }).find(
    (sheet) => sheet.name === 'styles/fonts.css',
  )
  const faces = fontsSheet?.css.match(/@font-face\s*\{[^}]*\}/g) ?? []

  it('declares exactly an upright and an italic face for each Garamond', () => {
    expect(fontsSheet, 'styles/fonts.css is missing').toBeDefined()
    const pairs = faces.map((face) => {
      const family = /font-family\s*:\s*'([^']+)'/.exec(face)?.[1]
      const style = /font-style\s*:\s*([a-z]+)\s*;/.exec(face)?.[1]
      return `${family} ${style}`
    })
    expect(pairs.sort()).toEqual([
      'Cormorant Garamond italic',
      'Cormorant Garamond normal',
      'EB Garamond italic',
      'EB Garamond normal',
    ])
    for (const face of faces) {
      expect(face).toMatch(/font-weight\s*:\s*\d+\s+\d+\s*;/)
      expect(face).toMatch(/font-display\s*:\s*swap\s*;/)
    }
  })

  it('points every face at a file that exists', () => {
    const sources = faces.map((face) => /url\('([^']+)'\)/.exec(face)?.[1])
    expect(sources).toHaveLength(4)
    const fontsCss = new URL('./fonts.css', import.meta.url)
    for (const source of sources) {
      expect(source, 'a face has no url()').toBeDefined()
      const path = fileURLToPath(new URL(source ?? '', fontsCss))
      expect(existsSync(path), `${source} is missing`).toBe(true)
    }
  })
})
