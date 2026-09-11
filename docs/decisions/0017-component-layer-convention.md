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

### Vocabulary

| Component | Classes | Notes |
| --- | --- | --- |
| `Button` | `.btn`, `.btn--primary` / `--secondary` (default) / `--ghost` / `--danger`, `.btn__seal` | Defaults to `type="button"`. `seal` adds the wax-seal glyph, reserved for the signature Inscribe action. |
| `Tag` | `.tag`, `.tag--neutral` (default) / `--success` / `--warning` / `--danger` | A `<span>` with no ARIA role. |
| `Panel` | `.panel`, `.panel > legend` | `as` picks `div` (default), `section`, `aside`, or `fieldset`. A fieldset gets its `<legend>` as first child. |
| `Field` | `.field`, `.field__label` | The label wraps the control (implicit association, no ids). |
| `Input`, `Select`, `Textarea` | `.control` | Native controls with the class added. |
| `PrintingChip` | `.printing-chip`, `--sm` (default) / `--md`, `__thumb`, `__text` | Art plus "Set Name (SET) · #num" via `describePrinting()` from `printing.ts`. |

**Primary and danger share the oxblood hue; treatment tells them apart.**
Primary is filled oxblood. Danger is outlined oxblood-bright. There is no
filled danger button. The Catalog's confirm-removal button, currently a filled
accent, becomes `primary` when VEG-424 adopts the layer. The quantity
stepper's round icon buttons stay bespoke (`.qty-stepper__step`); they are not
a `Button` variant.

**Tag tones carry the import-preview vocabulary.** A row that is ready is
`success` (verdant), one that still needs a printing chosen is `warning`
(gold), one that matched nothing is `danger` (oxblood). Everything else is
`neutral`.

**The chip does not reuse `CardThumb`.** `CardThumb` renders a placeholder
with an `aria-label` when the catalog holds no art. Inside a listbox option
that label would join the option's accessible name, so every "Sol Ring" option
would read "Sol Ring (no image in the catalog) Commander 2021...". The chip
simply omits the thumbnail instead; the option is named by the printing text
alone.

**A dev-only specimen sheet.** `/specimens` renders every component in every
state. `App.tsx` imports it lazily and only when `import.meta.env.DEV` is
true, so the production build drops both its chunk and its stylesheet; it is
not in the nav. The layer has few consumers until VEG-424 lands, and the
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
  panel surface). The danger button and the danger, success, and warning tags
  use the palette tokens as they are, and `--danger` on `--surface` is about
  3.4:1 at 15px. Retuning those tokens is the accessibility pass (VEG-427),
  which owns the palette; the layer will pick the change up for free.

- VEG-424 replaces the ad-hoc rules in `inscribe.css` and `decklist.css` with
  these classes and drops the two private `describe()` helpers in the
  onboarding pages (and the inline copy in `InscribeForm`) in favour of
  `describePrinting()`. The same pass migrates `catalog.css`, whose
  `.lot-editor` controls and labels and `.lot-remove__*` buttons duplicate
  `.control`, `.field__label`, and the button variants.
- The two pickers' option buttons share near-identical rules in the page
  sheets at (0,1,1) specificity, which out-ranks any `.btn` variant. VEG-424
  should add a shared listbox-option class to this layer when it replaces
  them, rather than reaching for `.btn--ghost`.
- Double-faced printings show no thumbnail because their art lives on
  `card_faces` and the picker queries return `cards` rows only. Tracked as
  VEG-557.
- `CardThumb` and its `.card-thumb` rules are already token-only and
  presentational; move them from `catalog/` into `components/` when the next
  consumer outside the Catalog appears.
