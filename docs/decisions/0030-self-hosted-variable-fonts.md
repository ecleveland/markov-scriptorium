# 0030 Self-hosted variable fonts from upstream

**Status:** accepted (2026-11-05)

Resolves part of [VEG-620]. Amends [ADR 0014](0014-visual-identity-and-design-tokens.md),
which self-hosted the webfonts through npm font packages. This record keeps
self-hosting and changes where the files come from.

[VEG-620]: https://linear.app/cleveland-family-enterprises/issue/VEG-620

---

## Context

VEG-620 moved the app to two Garamonds, Cormorant Garamond for display and EB
Garamond for body, labels and data. The ledger direction rests on two
OpenType features. Labels and table headers use small caps (`smcp`) through
`--caps`, and counts use old-style figures (`onum`) through `--figures`.

The first cut loaded both families from Fontsource. Its woff2 builds carry
neither feature. fontTools found no `smcp` and no `onum` in any of the seven
files loaded. So the browser drew synthesized small caps, which are shrunken
capitals with thin strokes, and EB Garamond kept its lining figures. The
tests passed throughout, because they check the CSS and not what the font
renders.

## Decision

**Self-host the upstream variable fonts.** The source is the OFL variable TTFs
in the google/fonts repository, pinned to commit
`fbe81817505e8aeadc53cc7a38a2b76fb57c333e`. Both EB Garamond styles carry
`smcp`, `c2sc`, `onum`, `lnum`, `tnum` and `pnum`. Both Cormorant Garamond
styles carry `onum`, `lnum` and `tnum`. The upright adds `smcp` and `c2sc` but
has no `pnum`. The italic adds `pnum` but has no `smcp` or `c2sc`.

**Subset them to Latin with fontTools.** `frontend/scripts/subset-fonts.sh`
downloads the four styles and keeps Latin, Latin-1, Latin Extended-A, general
punctuation and the four arrows the UI draws. The range starts from Google
Fonts' latin subset but is not identical to it. Latin Extended-A covers names
such as Łukasz, and the old npm builds shipped it as their latin-ext subset.
The back links draw a left arrow and the importers a right one. The script
also keeps the shaping, small-caps and figure features, and writes woff2
files to `frontend/src/assets/fonts/`. It pins fontTools and brotli, so a
rerun from the same commit gives the same bytes. The four files total about
255 KB. The OFL text for each family sits beside them. The files are
committed, and the script exists so they can be rebuilt from the same commit.

**One face per family and style.** `frontend/src/styles/fonts.css` declares
four `@font-face` rules, upright and italic for each family, and `index.css`
imports it before the tokens. Each file holds the whole weight axis: 300 to
700 for Cormorant Garamond, 400 to 800 for EB Garamond. Every weight a sheet
asks for comes from the file, so the weight list in `main.tsx` is gone along
with the packages.

## Alternatives

- **Fontsource.** It strips the two features this direction exists for.
- **The Google Fonts CDN.** Its builds keep the features, but every page load
  would call a hosted service. CLAUDE.md puts local-first ahead of that, and
  the app should render the same offline.
- **The upstream TTFs uncut.** They need no script, but the four files come to
  about 3.5 MB, against about 255 KB subset.

## Notes

- Cormorant Garamond italic has no `smcp` upstream either, so small caps in
  display italic would be synthesized. Nothing sets small caps in display
  italic today.
- The fonts are binaries in the repository. `.gitattributes` marks `*.woff2` as
  binary so Git never diffs or normalizes them.
- `fonts.css` is the one sheet besides `tokens.css` allowed to write a family
  name. `components.test.ts` holds it to four faces, two per family, each with
  a weight range and `font-display: swap`. `fonts.test.ts` checks the files
  are present.
