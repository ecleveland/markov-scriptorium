# 0017 — Component Layer Convention

**Status:** accepted (2026-09-10)

Decided while building the shared component layer ([VEG-423]), the third
ticket of milestone M3.7. [0014](0014-visual-identity-and-design-tokens.md)
supplied the tokens and left the treatment of buttons, tags, panels, and form
controls to "the component layer". This ADR is that layer's contract: where
components live, how they are styled, and which vocabulary the page restyle
(VEG-424) and the M4/M5 screens build on.

[VEG-423]: https://linear.app/vega-apps/issue/VEG-423

---

## Decision

**Plain presentational React components plus one global stylesheet.**

- Components live in `frontend/src/components/`, one file per component, with
  a barrel `index.ts`. They are dumb: they add a class, spread native props
  through, and hold no state. React 19 passes `ref` as an ordinary prop, so
  there is no `forwardRef` wrapping.
- Their styles live in `frontend/src/styles/components.css`, imported from
  `index.css` directly after `tokens.css`. The sheet consumes tokens only: no
  raw colours, no font names. `components.test.ts` fails the build if either
  appears.
- Class names follow the BEM-ish scheme the page sheets already use: a short
  block per component, `--` for modifiers, `__` for elements.

**Cascade order is part of the contract.** `components.css` loads before every
page sheet (each page module imports its own CSS), so a page rule at equal
specificity wins. Pages layer layout and one-off tweaks on top of the component
classes rather than restyling elements from scratch, and never need
`!important`.

**The focus ring is drawn once, as an outline.** `index.css` sets the gold
`--focus-ring` on `:focus-visible` globally. VEG-421 drew it with `box-shadow`;
this ticket moves it to `outline` (with `outline-offset`) so `box-shadow` stays
free for elevation without any risk of a component shadow hiding the ring.
`components.css` never declares `outline`, and its hover guards are written
`:hover:where(:not(:disabled))` so they add no specificity. Both are
contract-tested.

**Two new tokens for hover.** Hover and selected fills were hardcoded
translucent white in `inscribe.css` and `decklist.css`; the no-raw-colour rule
needed tokens for them. `--surface-hover` is translucent bone, the fill for a
transparent element such as a listbox option or a ghost button, and both page
sheets now use it for their option hover. `--surface-raised-hover` is the same
step composed onto the raised surface with `color-mix()`, for opaque elements
that swap `background-color` on hover. Both sit beside `--surface-raised` in
`tokens.css` and are pinned in `tokens.test.ts`. `color-mix()` sets the
browser floor at Chrome 111, Safari 16.2, and Firefox 113 (all 2023); older
engines drop the hover fill and the selected-candidate highlight, which is
acceptable for a single-user local app that ships inside a current WebKit
once packaged.

**Button fills are custom properties.** `.btn` reads `--btn-bg`,
`--btn-bg-hover`, `--btn-border`, and `--btn-border-hover`; the rest state and
the single hover rule are written once against those, and each variant is
fully described by the properties it sets. A page that needs a differently
coloured button sets the properties on its own class rather than fighting the
hover rule, and `background-color` stays a transitioned property so every
variant fades the same way. Contract-tested.

**Motion is opt-in by media query.** `animation` and `transition`
declarations live only inside `@media (prefers-reduced-motion:
no-preference)`, so a page is still by default and moves only for people who
have not asked the OS to reduce motion. The `@keyframes` blocks themselves can
sit anywhere. Since VEG-427 the 120ms hover fades on buttons, controls, listbox
options, and nav links sit under the query too, and snap for everyone else.
A media query list such as `screen, (prefers-reduced-motion: no-preference)`
does not count. Contract-tested across every sheet.

### Vocabulary

| Component | Classes | Notes |
| --- | --- | --- |
| `Button` | `.btn`, `.btn--primary` / `--secondary` (default) / `--ghost` / `--danger`, `.btn__seal` | Defaults to `type="button"`. `seal` adds the wax-seal glyph, reserved for the signature Inscribe action; it renders only with `primary` and is ignored elsewhere (a flat prop, since a union would not survive `Omit`/`Pick` in wrappers). |
| `Tag` | `.tag`, `.tag--neutral` (default) / `--success` / `--warning` / `--danger` | A `<span>` with no ARIA role. |
| `Panel` | `.panel`, `.panel > legend` | `as` picks `div` (default), `section`, `aside`, or `fieldset`. A fieldset gets its `<legend>` as first child. |
| `Field` | `.field`, `.field__label` | The label wraps the control (implicit association, no ids). |
| `Input`, `Select`, `Textarea` | `.control` | Native controls with the class added. |
| `PrintingChip` | `.printing-chip`, `--sm` (default) / `--md`, `__thumb`, `__text` | Art plus "Set Name (SET) · #num" via `describePrinting()` from `printing.ts`. |
| `PageHeader` | `.page-header`, `__eyebrow`, `__title`, `__actions` | The block a page opens with. `level` picks `h1` (default) or `h2`; children become the actions beside the title. Heading type comes from `index.css` and the gold `h1` from `App.css`. |
| `Notice` | `.notice`, `.notice--muted` (default) / `--success` / `--danger`, `.notice--inline` | A `<p>` for one line about the page's state. No ARIA role of its own; a caller that needs the line announced passes `role="alert"` or `role="status"`. `as="span"` renders it inline (adds `.notice--inline`) for a button row or a table cell. Danger reads `--danger`, which VEG-427 lifted to AA. |
| `Seal` | `.seal`, `__wax`, `__ring`, `__mark` | The house crest as an `aria-hidden` SVG with no role. The consumer sets its size. The header's brand mark renders it; the button's small `btn__seal` glyph is separate. |
| `Sealed` | `.sealed`, `__seal`, `__text`, `__title`, `__body` | The confirmation moment: the seal pressed beside the message. `title` defaults to "Sealed into the catalog". No role of its own; callers pass `role="status"`. The seal plays `seal-press` once. |
| `EmptyState` | `.empty-state`, `__seal`, `__title`, `__body` | An unpressed seal, an `h2` title, and a muted body whose links are gold. No role. |
| `Consulting` | `.consulting`, `__candle`, `__text` | The loading line: a muted `Notice` with a flickering candle, defaulting to "Consulting the catalog…". No role by default. It takes no `as`, since the candle row is a flex box an inline span cannot be, and its text sits in one `__text` span. |
| Listbox (classes only) | `.listbox`, `.listbox__option` | A labelled `<ul>` of option buttons with arrow-key focus movement from `useArrowKeyList` (`src/hooks`). No `listbox` or `option` roles: an option may not contain a button, and a list of buttons is what it is. `.listbox__option[aria-pressed='true']` draws the gold inset rule on the chosen row. |

**Primary and danger share the oxblood hue; treatment tells them apart.**
Primary is filled oxblood. Danger is outlined rose, the AA-contrast step of
the oxblood family (VEG-427). There is no filled danger button. The Catalog's
confirm-removal button, currently a filled accent, becomes `primary` when
VEG-424 adopts the layer. The quantity stepper's round icon buttons stay
bespoke (`.qty-stepper__step`); they are not a `Button` variant.

**Tag tones carry the import-preview vocabulary.** A row that is ready is
`success` (verdant), one that still needs a printing chosen is `warning`
(gold), one that matched nothing is `danger` (oxblood). Everything else is
`neutral`. All three coloured tones read semantic tokens; `--warning` (an
alias of `--gold`) joins `--success` and `--danger` in `tokens.css` so a tone
is retuned at the token, never in the component rule.

**The chip does not reuse `CardThumb`.** `CardThumb` renders a placeholder
with an `aria-label` when the catalog holds no art. Inside a listbox option
that label would join the option's accessible name, so every "Sol Ring" option
would read "Sol Ring (no image in the catalog) Commander 2021...". The chip
renders a label-free, `aria-hidden` empty slot of the same width instead, for
rows with no art and for images that fail to load, so a list that mixes
printings with and without art (the CSV importer can surface art-series and
reversible printings whose art lives per face) stays aligned, and the option
is named by the printing text alone.

**A dev-only specimen sheet.** `/specimens` renders every component in every
state. It lives in `src/specimens/` as a page, not in the layer, and imports
through the barrel it exercises. `App.tsx` imports it lazily and only when
`import.meta.env.DEV` is true, so the production build drops both its chunk
and its stylesheet; it is not in the nav. The gate has to stay a module-level
ternary around `lazy()`: an unconditional `lazy()` with only the route gated
still emits the chunk, because Rollup cannot prove the call pure. The layer has few consumers until VEG-424 lands, and the
accessibility pass (VEG-427) needs one page where every state is visible.

## Alternatives

- **CSS modules.** Zero dependencies with Vite, and real scoping. Rejected
  because hashed class names break the class-based E2E locators (`.status`)
  and make page-level overrides awkward, and scoping solves a problem a
  single-app codebase with one bundled sheet does not have.
- **CSS-in-JS libraries** (styled-components, vanilla-extract, or similar).
  Rejected because they add a dependency for theming the tokens already
  provide, and the project prefers boring tools that still run in five years.
- **Keep per-page CSS and copy rules between pages.** Rejected because that is
  the status quo this ticket exists to end. Three pages already carried three
  copies of the same button and listbox rules with three different colours.

## Follow-ups

- Contrast. Field labels and legends use `--text-muted` (about 6.5:1 on the
  panel surface) and gold passes at about 6.3:1, so the warning tag is fine.
  The danger button and danger tag use `--danger` as it is, about 3.4:1 on
  `--surface` at 15px. Retuning that token is the accessibility pass
  (VEG-427), which owns the palette; the layer will pick the change up for
  free.

- VEG-424 replaced the ad-hoc rules in `inscribe.css` and `decklist.css` with
  these classes and dropped the two private `describe()` helpers in the
  onboarding pages (and the inline copy in `InscribeForm`) in favour of
  `describePrinting()`. Both sheets are layout now, on tokens only. Still
  open: `catalog.css`, whose `.lot-editor` controls and labels and
  `.lot-remove__*` buttons duplicate `.control`, `.field__label`, and the
  button variants.
- The three pickers' option buttons duplicated near-identical rules in the page
  sheets at (0,1,1) specificity, which out-ranks any `.btn` variant. VEG-424
  added `.listbox` and `.listbox__option` here instead of reaching for
  `.btn--ghost`; `CardSearch`, `PrintingPicker`, and `CandidatePicker` all
  render them.
- Double-faced printings show no thumbnail because their art lives on
  `card_faces` and the picker queries return `cards` rows only. Tracked as
  VEG-557.
- `CardThumb` and its `.card-thumb` rules are already token-only and
  presentational; move them from `catalog/` into `components/` when the next
  consumer outside the Catalog appears.
- VEG-426 added `Seal`, `Sealed`, `EmptyState`, and `Consulting`, and gave
  `Notice` its `as` prop. VEG-427 folded the hover transitions into the
  motion rule.
- VEG-427 dropped the `listbox` and `option` roles from the pickers because
  each option wrapped a button, which ARIA forbids. If screen-reader users
  want "n of m" announcements, the upgrade is a true listbox with a roving
  tabindex, built in `useArrowKeyList`.
