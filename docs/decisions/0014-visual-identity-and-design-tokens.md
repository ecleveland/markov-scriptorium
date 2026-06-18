# 0014 — Visual Identity & Design Tokens

**Status:** accepted (2026-06-18)

Establishes the visual foundation for milestone M3.7 ([VEG-421]): the
candlelit-obsidian theme expressed as CSS custom properties, plus the
self-hosted webfont stack. The rest of the milestone (app shell, component
layer, page restyles) consumes these tokens and adds no new raw colours or
font names.

No behaviour change — this is purely the styling foundation.

[VEG-421]: https://linear.app/vega-apps/issue/VEG-421

> **Provenance note.** The ticket references a "2026-06-18 design exploration"
> (mockup + swatches + A/B/C directions). That artifact was not preserved in the
> repo, Linear documents, or comments. The palette hexes and font intent below
> are taken verbatim from the ticket body; the A/B/C summaries are reconstructed
> to match the chosen "hybrid C+B" direction and should be corrected if the
> original exploration resurfaces.

---

## Decision

**1. Direction: hybrid C+B — "candlelit obsidian."** An obsidian, type-led dark
ground (direction C) carries the data-dense, image-forward surfaces; oxblood +
antique-gold identity accents and editorial serif typography (direction B) supply
the gothic-archival warmth. Dark grounds let card art provide the colour while
the chrome stays restrained.

**2. Two-layer token system.** `frontend/src/styles/tokens.css` is the single
source of truth, imported at the top of `index.css`:

- **Raw palette** — the literal colours: obsidian grounds (`--bg #0e0c10`,
  `--panel #16131b`, `--line #2a2531`), oxblood identity (`--oxblood #8f1d2b`,
  `--oxblood-bright #c0394e`), antique `--gold #b3925b`, antique-moss
  `--green #6f8f5a`, and the bone text ramp (`--text #ece5d8`, `--muted #a39a8b`,
  `--faint #6f665a`).
- **Semantic aliases** — intent-named tokens consumers should use:
  `--surface`→panel, `--border`→line, `--accent`→oxblood (`--accent-hover`→
  oxblood-bright), `--accent-secondary`→gold, `--danger`→oxblood-bright,
  `--success`→green, plus the `--text-*` ramp.

Values fixed by the ticket (`--bg`, `--panel`, `--oxblood`, `--oxblood-bright`,
`--gold`, `--text`) are pinned by a contract test (`tokens.test.ts`) so a later
restyle can't silently rename or drop them. `--line`, `--green`, `--muted`,
`--faint` and the scales were left unspecified by the ticket and chosen here.

**3. Accent vs. danger share the oxblood family, disambiguated by treatment.**
Oxblood is the house identity, so it is the primary `--accent`; `--danger` is
`--oxblood-bright`. Hue alone does not separate "primary action" from
"destructive" — that is the component layer's job (filled vs. outline,
VEG-423). The **focus ring is gold** (`--focus-ring`), deliberately a different
hue from both so focus never reads as selection or danger.

**4. Self-hosted OFL webfonts, not a system stack.** The fonts named in the
ticket (Didot, Hoefler Text, Avenir, Iowan Old Style, Palatino) are
Apple/commercial and cannot be legally bundled. We self-host the closest
well-regarded SIL-OFL substitutes via [Fontsource] (woff2 shipped into the build,
no runtime CDN call), with the original Apple fonts trailing as graceful
fallbacks:

| Role | Ticket intent | Self-hosted (OFL) |
| --- | --- | --- |
| Display / headings | Didot / Hoefler | **Playfair Display** (600, 700) |
| Body | Iowan / Palatino | **Spectral** (400, 400-italic, 600) |
| UI / labels | Avenir | **Mulish** (500, 600, 700) |
| Status | SF Mono | **IBM Plex Mono** (400, 500) |

Imported in `main.tsx` (the reliable path with Vite); exposed as
`--font-display / --font-body / --font-sans / --font-mono`. Self-hosting (over a
system stack) was chosen for cross-platform fidelity ahead of Tauri packaging,
at the cost of four build-time deps and ~tens of KB of woff2.

[Fontsource]: https://fontsource.org

**5. Type / spacing / radius / elevation scales.** Root font-size is `112.5%`
(=18px) so `--text-base` (1rem) is 18px and the rest of the rem scale follows.
Scales: `--text-xs … --text-3xl` with `--leading-{tight,snug,normal}`;
`--space-1 … --space-8` (0.25–3rem); `--radius-{sm,md,lg,full}`;
`--elevation-1 … 3` (shadow lift off the obsidian ground).

**6. Migration scope.** Only `index.css` (defined the old vars) and `App.css`
(consumed them) referenced the ad-hoc `--bg/--panel/--border/--ink/--ink-dim/
--gold`. Both were repointed to the new tokens. `inscribe.css` and `decklist.css`
hardcode their colours and reference no vars, so they are untouched here and get
migrated in the restyle ticket (VEG-424).

## Alternatives

- **Direction A — light parchment / manuscript.** A literal cream
  ink-on-paper scriptorium. Rejected: a card-image-heavy browser needs a dark
  ground so art pops; a light ground causes glare and fights the imagery.
- **Direction B alone — gilded heraldic.** Gold-forward, ornate, crest and
  border motifs. Strong identity but ornament-heavy is hard to maintain and
  hurts legibility at data density. Kept its *accents and typography*, dropped
  the ornament.
- **Direction C alone — pure obsidian minimal.** Restrained modern dark UI.
  Scales well but risks reading generic/cold with no house identity. The hybrid
  grafts B's identity onto C's restraint.
- **System font stack** (no bundled fonts) — zero deps and renders the original
  Apple fonts on the dev Mac, but loses fidelity on any other platform (relevant
  once packaged). Rejected in favour of self-hosting; flagged and confirmed.
- **Single flat token layer** (no raw/semantic split) — simpler, but couples
  consumers to literal colours and makes a future re-theme a find-and-replace.
  The semantic layer is the seam that keeps the restyle tickets cheap.

## Notes / follow-ups

- Tokens carry no light-theme counterpart; the app is dark-only by design.
- Only the weights listed are imported; later tickets add weights as needed
  rather than importing the full families up front.
- `--surface-raised` is provided for elevated panels (modals/menus) the
  component layer will introduce.
