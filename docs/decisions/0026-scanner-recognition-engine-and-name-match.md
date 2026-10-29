# 0026 Scanner recognition engine and name match

**Status:** accepted (2026-10-27)

Resolves [VEG-231] and extends [ADR 0025](0025-scanner-capture-and-recognition-contract.md).
Decides which engine reads the card title off a capture, where on the frame it
looks, and how the text it reads becomes a card name from the local catalog.

[VEG-231]: https://linear.app/cleveland-family-enterprises/issue/VEG-231

---

## Decision

**An `Ocr` protocol over encoded image bytes.** Every engine sits behind one
call, `read_lines(image, *, upside_down, region) -> list[TextLine]`, with one
adapter per engine. The engine takes the JPEG or PNG bytes the browser posted,
so the pipeline never decodes an image itself. Each `TextLine` carries its text,
the engine's confidence, and a box in fractions of the frame with the origin at
the top left.

**Apple Vision is the first engine.** The adapter calls
`VNRecognizeTextRequest` through pyobjc-framework-Vision. It runs on macOS
only, and `uv sync` installs it there through a `sys_platform == 'darwin'`
marker. The request uses the accurate recognition level, the en-US language,
and turns language correction off, because card names are not dictionary
words.

What we verified about Vision, for the next person who touches the adapter:

- Vision applies the orientation argument before it reads, and reports boxes in
  the upright frame.
- The region of interest applies after orientation.
- Boxes returned under a region are relative to that region. The adapter scales
  them back to the full frame.
- Bytes it cannot decode come back as an NSError, which the adapter turns into
  the 400 below.
- A region read takes about 30 ms on a 1280x960 frame. The first call in a
  process takes about 0.4 s.
- Wrapping every call in `objc.autorelease_pool()` keeps memory flat across
  scans.

**Read the title region first, then widen.** The pipeline makes up to three
passes and stops at the first that yields a match.

1. The title region, which is the centre column across the top 30 percent of
   the frame. A card lined up to the page's guide puts its title bar there.
2. The same region with the frame rotated 180 degrees, for a card laid upside
   down.
3. The full frame, with every match it yields weighted by 0.9.

An upright card lined up to the guide costs one engine call.

**Pick the title by geometry.** From the lines a pass returns, the pipeline
drops any with fewer than 3 letters, which removes mana pips and collector
numbers. It keeps lines centred in the middle band of the frame, orders them
top-most first and then tallest, and passes up to 3 candidates to the matcher.
The matcher decides which one is the name.

**Match names with rapidfuzz.** `process.extract` with plain `fuzz.ratio` and
a score cutoff of 60 runs over every distinct `cards.name` plus every
`card_faces.name`. Each face name maps back to the full `cards.name`, so a read
of "Delver of Secrets" answers "Delver of Secrets // Insectile Aberration".
Readings are always the full stored name, because the browser's printing
picker keeps only printings whose name equals the reading exactly.
`art_series` cards are left out. Tokens stay in, but a token loses a name
collision to a real card.

Both sides go through the same fold before comparison:

- NFKD, then drop the accents, and turn `æ` into `ae`.
- Casefold.
- Turn `i`, `1`, `|` and `!` into `l`, `0` into `o`, `5` into `s`, `rn` into
  `m`, and `vv` into `w`.
- Drop everything that is not a letter or a digit.

Each candidate line also tries two trimmed variants: one with up to three
trailing tokens dropped, for mana symbols read as text, and one with a leading
one-character speck dropped.

Plain `ratio` wins over `WRatio` and `partial_ratio`. Those two score short
names such as Opt and Fog at 100 inside almost any longer line.

**Confidence.** A reading scores `ratio * (0.7 + 0.3 * engine_confidence)`,
with the ratio taken from 0 to 1. Readings below 0.6 are dropped, duplicates
of the same full name keep their best score, and the endpoint answers the top
5. These are starting values. The PR for VEG-231 records a calibration against
real captures.

**The name index is cached per process.** The pipeline builds the folded name
list once, behind a lock, and keys it on the database path,
`scryfall_refresh.imported_at`, and the card count. One cheap query per scan
checks the key, so a Scryfall refresh rebuilds the index on the next capture.
`invalidate()` drops the cache by hand. A future restore ([VEG-613],
[VEG-614]) must call it, because a restored file can carry the same refresh
stamp and card count as the one it replaced.

[VEG-613]: https://linear.app/cleveland-family-enterprises/issue/VEG-613
[VEG-614]: https://linear.app/cleveland-family-enterprises/issue/VEG-614

**Three statuses join the ADR 0025 contract.** They run after its existing
415, 413 and 400 checks.

- 503 "No scrying glass is fitted to this scriptorium. Type the name instead."
  when no engine is available.
- 400 "The glass could not make sense of that image. Capture the card again."
  when the engine cannot decode the bytes.
- 503 "The glass clouded over while reading. Try the capture again, or type the
  name instead." when the engine fails while reading.

A valid image on a Mac answers 200. The 501 stub is gone.

**`SCRIPTORIUM_OCR` picks the engine.** `auto`, the default, loads Vision when
it can and answers the first 503 when it cannot. `vision` fails at startup if
Vision cannot load. `none` turns the scanner off.

**The page asks the camera for 1920 by 1080.** The request is an ideal, so a
camera that cannot reach it still opens. Most USB webcams default to 640 by
480, which leaves the title about 14 pixels tall.

**Non-English printings cannot be recognised.** The catalog stores Scryfall's
English `name` on every printing and does not import `printed_name`. A German
title has nothing to match against. Adding it is a schema change for its own
ticket.

## Alternatives

- **Tesseract.** It needs a Homebrew binary driven by subprocess or
  pytesseract, a system dependency `uv sync` cannot express. Of the three
  engines weighed it reads the Beleren title font worst, and a blurred 14 pixel
  glyph is still blurred after upscaling. It is the right second engine for
  Linux and Windows, behind the same protocol and found through
  `SCRIPTORIUM_TESSERACT`.
- **rapidocr on onnxruntime with the PaddleOCR models.** Its OpenCV card
  detection handles skewed and off-centre cards best. It also costs 250 to
  350 MB of packages, several only weeks old, and hides a model download from
  modelscope.cn that we would have to design out.
- **Cloud OCR from Google Vision or Azure.** PROJECT.md recommended this. It
  sends the owner's images off the machine, and the free tiers can lapse. The
  local-first rule rules it out, and this record supersedes that
  recommendation.
- **ocrmac.** It wraps the same Vision call, needs Pillow, and hides the
  parameters we set. The call is about 25 lines.
- **difflib for the match.** It takes about a second over 33,000 names.
- **The SQLite trigram FTS as a prequery.** One misread letter drops every
  trigram it touches, so a near miss never reaches the scorer.
- **SymSpell, as mtgscan uses.** More machinery than one title per capture
  needs.

## Reasoning

The owner scans on an Apple Silicon Mac. The project is local-first and costs
nothing to run, and CLAUDE.md asks for boring, durable tools and a short
dependency list. Vision has been an OS API since macOS 10.15 and is not
deprecated in the macOS 26 SDK. pyobjc has bound it for two decades. The cost
is about 8 MB of MIT packages, with no install step, no model file, and no
network call at any time.

The protocol keeps that choice cheap to extend. A Tesseract adapter for Linux
and Windows slots in beside Vision without touching the matcher or the
endpoint, and the tests already run every path through a fake engine.

Reading names and not printings keeps the matcher small. The user picks the
printing from the card in hand, as ADR 0025 decided.

## Consequences

- Linux and Windows answer the first 503 and offer typing until a second
  engine lands. A follow-up ticket covers the Tesseract adapter.
- The [ADR 0002](0002-desktop-shell-tauri-sidecar.md) sidecar grows by about
  7 MB on macOS and needs pyobjc hidden imports under PyInstaller. On Windows
  it needs the second engine before the scanner works.
- The cloud OCR line in PROJECT.md is superseded.
- mypy gets an `ignore_missing_imports` override for the pyobjc modules, the
  same pattern as `ijson`.
- The test suites never touch real Vision except one macOS-only test marked
  `vision`. Every other scanner test uses a fake engine through a FastAPI
  dependency override.
- A restore, when it lands, must call `invalidate()`.
- [ADR 0028](0028-tesseract-as-the-second-scanner-engine.md) adds Tesseract as
  the second engine behind the same protocol for Linux and Windows.
