// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Contract test for the shared component stylesheet (VEG-423, ADR 0017).
//
// The component layer consumes design tokens only. No raw colours or font
// names may appear here, so a later re-theme is a tokens.css edit and nothing
// else. (focus-ring.test.ts separately guarantees no sheet, this one included,
// sets `outline`; box-shadow stays free for elevation.)

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

const css = readFileSync(
  fileURLToPath(new URL('./components.css', import.meta.url)),
  'utf8',
)

/** Declarations only. Comments are stripped so prose can name what is forbidden. */
const declarations = css.replace(/\/\*[\s\S]*?\*\//g, '')

describe('component stylesheet contract', () => {
  it('uses no raw colour values', () => {
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

  it('uses no raw font family names', () => {
    expect(declarations).not.toMatch(/font-family\s*:(?!\s*var\()/)
  })

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
      .filter((selector) => /^\.(btn|control)\b.*:hover/.test(selector))
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
    ]) {
      expect(declarations, `missing ${block}`).toContain(`${block} {`)
    }
  })
})
