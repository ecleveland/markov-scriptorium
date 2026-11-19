# 0035 The house seal

**Status:** accepted (2026-11-19)

Resolves [VEG-621]. Amends [ADR 0014](0014-visual-identity-and-design-tokens.md),
which left the mark as a placeholder, and [ADR 0017](0017-component-layer-convention.md),
whose `Seal` row gains three classes.

[VEG-621]: https://linear.app/cleveland-family-enterprises/issue/VEG-621

---

## Context

Since VEG-426 the brand mark was a scalloped wax blob, a thin gold ring and a
text node "M" set in the display face. The mark waited on the webfont, and
nobody had drawn it for any size but the 36 px header. The favicon was still
Vite's purple bolt. The ticket asked for a design exploration before code.

## The exploration

Three directions were drawn on a design canvas
(https://claude.ai/artifact/6g1FDXiGe4nFHRgyKY86ip). Each appears at 200, 56,
32 and 16 px, and each sits in the running head, the Sealed moment, an empty
state and a browser tab.

- **A, the impression.** A wax disc with a spread lip and a lit edge. The M of
  the die is pressed into a darker field inside a thin gold ring.
- **B, the device.** A drop of blood with bat wings spread, gold on an oxblood
  roundel, with a bone glint on the drop. At 16 px only the drop remains.
- **C, the wordmark.** The name set whole in bone in the display face. The mark
  shrinks to a drop held in a gold ring, which also becomes the favicon.

## Decision

Direction A.

It is one object at three scales, so the header, the Sealed moment and the
empty state stay one idea. The Sealed moment wants a seal, not a device. B
reads as a game icon beside the ledger pages, and its wings turn to noise at
32 px. C is the quietest, but a drop in a ring says nothing about a
scriptorium, and it would have forced a header change the restyle milestone
did not ask for.

## How it is drawn

`Seal.tsx` draws five pieces, back to front.

1. The wax with its lip (`seal__wax`, `--oxblood`).
2. The pressed field of the die (`seal__field`, `--accent-pressed`).
3. The lit edge of the lip at the upper left (`seal__lit`, `--oxblood-bright`).
4. The die's ring (`seal__ring`, `--gold`).
5. The M as a group of two stroked paths, stems and diagonals first and serifs
   second (`seal__mark`, `--gold`).

Geometry lives in the SVG attributes and colour lives in `components.css`
through tokens. The mark uses oxblood in three steps of one hue, plus gold.
Bone does not appear in it. There are no gradients and no filters inside the
SVG.

The M is a path group, not text, so the mark no longer depends on the font
loading. The class contract widens and nothing is removed. `.seal`, `__wax`,
`__ring` and `__mark` stay because `components.css`, the Sealed and EmptyState
overrides and the tests depend on them.

## The favicon is a second drawing

`public/favicon.svg` is a by-hand 16 px version of the same mark. The wax is a
plain disc and the M is one heavy stroke. It has no ring, serifs or lip,
because those vanish at 16 px. Files under `public/` sit outside the token
sheets, so it carries the literal hexes for `--oxblood` and `--gold` with a
comment naming the tokens. `seal-icons.test.ts` reads the favicon, the render
script and the token sheet together, so a retuned token or a changed path
fails a test instead of drifting.

## The 180 px PNG is rendered, not drawn

`frontend/scripts/render-icons.mjs` opens an inline page in Playwright's
bundled Chromium and screenshots the full-detail mark at 180 by 180 on the
`--bg` ground. The output is `public/apple-touch-icon.png`, kept for the Tauri
shell later. Chromium is already installed for the E2E suite, so this adds no
dependency. Apple touch icons have no alpha, so the ground is painted.

The script runs by hand when the mark changes, and the PNG is committed, as
the subset fonts are ([ADR 0030](0030-self-hosted-variable-fonts.md)).
`index.html` links both icon files.

## The specimen sheet

The specimen sheet shows the seal at 16, 32, 56 and 200 px, so a change to the
drawing is checked at every size it must survive.

## Consequences

- The mark renders before the webfont loads.
- Anyone changing `Seal.tsx` reruns the render script and commits the PNG. They
  also update `favicon.svg` by hand if the simplified drawing should follow.
- The direction B and C drawings stay on the canvas if the house ever wants a
  device for a different purpose.
