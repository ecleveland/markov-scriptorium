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

**One new token: `--surface-hover`.** Hover and selected fills were hardcoded
translucent white in `inscribe.css` and `decklist.css`; the no-raw-colour rule
needed a token for them. It is translucent bone, so it composes over any
ground: buttons lay it over their own fill as a `background-image`, and a
transparent element (a listbox option) uses it as its fill. Both page sheets
now use it for their option hover. It sits beside `--surface-raised` in
`tokens.css` and is pinned in `tokens.test.ts`.

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
filled danger button: the Catalog's confirm-removal button, currently a filled
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

- **CSS modules.** Zero dependencies with Vite, and real scoping. Rejected:
  hashed class names break the class-based E2E locators (`.status`) and make
  page-level overrides awkward, and scoping solves a problem a single-app
  codebase with one bundled sheet does not have.
- **Styled primitives** (styled-components, vanilla-extract, or similar).
  Rejected: a new dependency for theming the tokens already provide, and the
  project prefers boring tools that still run in five years.
- **Keep per-page CSS and copy rules between pages.** Rejected: that is the
  status quo this ticket exists to end. Three pages already carried three
  copies of the same button and listbox rules with three different colours.

## Follow-ups

- Contrast. Field labels and legends use `--text-muted` (about 6.5:1 on the
  panel surface). The danger button and the danger, success, and warning tags
  use the palette tokens as they are, and `--danger` on `--surface` is about
  3.4:1 at 15px. Retuning those tokens is the accessibility pass (VEG-427),
  which owns the palette; the layer will pick the change up for free.

- VEG-424 replaces the ad-hoc rules in `inscribe.css` and `decklist.css` with
  these classes and drops the two private `describe()` helpers in the
  onboarding pages in favour of `describePrinting()`.
- `CardThumb` and its `.card-thumb` rules are already token-only and
  presentational; move them from `catalog/` into `components/` when the next
  consumer outside the Catalog appears.
