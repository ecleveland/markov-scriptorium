// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

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

/** Declarations only. Comments are stripped so prose can name what is forbidden. */
function declarationsOf(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

const srcDir = fileURLToPath(new URL('..', import.meta.url))

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return cssFiles(path)
    return entry.name.endsWith('.css') ? [path] : []
  })
}

/** tokens.css is the one sheet allowed to name a colour or a typeface. */
const tokenSheet = join(srcDir, 'styles', 'tokens.css')

const sheets = cssFiles(srcDir)
  .filter((path) => path !== tokenSheet)
  .map((path) => ({
    name: path.slice(srcDir.length),
    declarations: declarationsOf(readFileSync(path, 'utf8')),
  }))

const declarations = declarationsOf(
  readFileSync(
    fileURLToPath(new URL('./components.css', import.meta.url)),
    'utf8',
  ),
)

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

  it.each(sheets)('$name uses no raw colour values', ({ declarations }) => {
    expect(declarations).not.toMatch(/#[0-9a-f]{3,8}\b/i)
    expect(declarations).not.toMatch(/\b(rgba?|hsla?|color-mix)\(/)
    // Named colours anywhere in a value, including shorthands like
    // `1px solid red`. Token references and property names are stripped
    // first so `--gold` and `white-space` do not trip it.
    const values = (declarations.match(/\{[^}]*\}/g) ?? []) // blocks only, no selectors
      .join('\n')
      .toLowerCase() // CSS keywords are case-insensitive
      .replace(/var\(--[a-z0-9-]+(,[^)]*)?\)/g, '') // token refs, with fallbacks
      .replace(/^\s*[a-z-]+\s*:/gm, ':')
    const words = values.match(/[a-z]+/g) ?? []
    expect(words.filter((w) => NAMED_COLOURS.has(w))).toEqual([])
  })

  it.each(sheets)('$name uses no raw font family names', ({ declarations }) => {
    expect(declarations).not.toMatch(/font-family\s*:(?!\s*var\()/)
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
    ]) {
      expect(declarations, `missing ${block}`).toContain(`${block} {`)
    }
  })
})
