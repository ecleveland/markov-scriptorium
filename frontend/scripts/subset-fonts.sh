#!/usr/bin/env bash
# Regenerate the self-hosted webfonts in src/assets/fonts (VEG-620, ADR 0030).
#
# Fontsource's woff2 builds of Cormorant Garamond and EB Garamond strip the
# small-caps (smcp) and old-style figure (onum) features the ledger typography
# depends on, so the fonts come from the upstream OFL variable TTFs in the
# google/fonts repository instead, pinned to one commit and subset to Latin.
#
# Needs curl and uv (for fontTools). Run from anywhere:
#   frontend/scripts/subset-fonts.sh
set -euo pipefail

COMMIT=fbe81817505e8aeadc53cc7a38a2b76fb57c333e
BASE="https://raw.githubusercontent.com/google/fonts/$COMMIT/ofl"
OUT="$(cd "$(dirname "$0")/.." && pwd)/src/assets/fonts"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Latin and Latin-1, general punctuation, the euro and a few arrows: the same
# range Google Fonts serves as its "latin" subset.
UNICODES='U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'
# Shaping, small caps, and every figure style, so --caps and --figures work.
FEATURES='kern,liga,calt,ccmp,locl,mark,mkmk,smcp,c2sc,onum,lnum,tnum,pnum,frac,ordn,case'

subset() {
  local family_dir="$1" source="$2" target="$3"
  # The upstream filenames carry [wght], which curl would otherwise read as a glob.
  curl -sSfL --globoff -o "$WORK/$source" "$BASE/$family_dir/$source"
  uvx --from fonttools --with brotli pyftsubset "$WORK/$source" \
    --output-file="$OUT/$target" \
    --flavor=woff2 \
    --unicodes="$UNICODES" \
    --layout-features="$FEATURES" \
    --no-hinting
}

mkdir -p "$OUT"
subset cormorantgaramond 'CormorantGaramond[wght].ttf' cormorant-garamond.woff2
subset cormorantgaramond 'CormorantGaramond-Italic[wght].ttf' cormorant-garamond-italic.woff2
subset ebgaramond 'EBGaramond[wght].ttf' eb-garamond.woff2
subset ebgaramond 'EBGaramond-Italic[wght].ttf' eb-garamond-italic.woff2

# The OFL requires its text to travel with the font software.
curl -sSfL -o "$OUT/OFL-cormorant-garamond.txt" "$BASE/cormorantgaramond/OFL.txt"
curl -sSfL -o "$OUT/OFL-eb-garamond.txt" "$BASE/ebgaramond/OFL.txt"

ls -la "$OUT"
