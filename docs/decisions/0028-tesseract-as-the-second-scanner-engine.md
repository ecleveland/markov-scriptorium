# 0028 Tesseract as the second scanner engine

**Status:** accepted (2026-10-29)

Resolves [VEG-649] and extends [ADR 0026](0026-scanner-recognition-engine-and-name-match.md).
Decides which engine reads cards when Vision is not there, how the Tesseract
adapter prepares a capture and reads back its output, and what the corner read
from [ADR 0027](0027-scanner-corner-read-pins-the-printing.md) loses on it.

[VEG-649]: https://linear.app/cleveland-family-enterprises/issue/VEG-649

---

## Decision

**Vision stays first and Tesseract comes second.** Vision remains the default
engine on macOS. Tesseract is the open-source engine Google has maintained
since 2006, under Apache-2.0, and the adapter runs it as a subprocess. It reads
on Linux and Windows, and it is the engine the Windows sidecar from
[ADR 0002](0002-desktop-shell-tauri-sidecar.md) will carry. On a Mac it runs
only when `SCRIPTORIUM_OCR=tesseract` is set. That is how the two engines were
compared.

**`SCRIPTORIUM_OCR` takes four values.**

- `auto`, the default, loads Vision on macOS. Elsewhere it loads Tesseract when
  the binary is found. Without one there is no engine, and the page offers
  typing.
- `vision` and `tesseract` force one engine. A forced engine that cannot load
  stops startup.
- `none` turns the scanner off.

The adapter looks for the binary at the path in `SCRIPTORIUM_TESSERACT` first,
then on the PATH.

Before Tesseract is chosen, the adapter probes the binary with
`tesseract --list-langs` and requires the English model in the list. A path
that will not run or a missing model counts as no binary. A forced setting then
stops startup and `auto` falls back to no engine, so a broken install never
leaves every scan answering 503.

**The adapter does what the command line cannot.** Tesseract takes an image and
returns text. Everything else the `Ocr` protocol asks for happens in Python,
with Pillow:

1. Decode the posted bytes.
2. For an upside-down card, turn the frame half a turn before cropping. Regions
   and boxes are then in the turned frame, as the protocol requires.
3. Crop to the region, or keep the whole frame when there is none.
4. Upscale the crop with Lanczos so the title bar reaches about 120 pixels of
   cap height. The factor stops at 4.
5. Stretch the contrast with a 1 percent cutoff and add a white border.

The adapter sends the result as PNG bytes on stdin:

```
tesseract stdin stdout -l eng --oem 1 --psm 6 -c tessedit_create_tsv=1
```

Page segmentation mode 6 reads a region as one block of text. A whole-frame
read uses mode 11, sparse text. Each call runs on one thread, with
`OMP_THREAD_LIMIT=1`, and gives up after 10 seconds.

**Reading the TSV.** Tesseract writes one row per word. The adapter groups the
words into lines by block, paragraph and line number, joins their text with
spaces, and boxes each line as the union of its word boxes. A line's confidence
is the mean word confidence divided by 100. Each box maps back through the
border, the scale and the crop origin to fractions of the frame, so the
pipeline sees the same geometry Vision gives it.

**Errors land on the statuses ADR 0026 set.**

- A missing binary, a timeout or a non-zero exit raise `OcrUnavailable`. On a
  non-zero exit the error carries the last five stderr lines joined, and the
  full stderr goes to the error log. Tesseract 5.5 prints "Failed loading
  language" three lines before "Could not initialize tesseract.", so the last
  line alone would lose the cause. The endpoint already turns `OcrUnavailable`
  into the 503 "The glass clouded over while reading."
- Bytes Pillow cannot open raise `UnreadableImage`, which answers the 400.

**What the comparison on the drawn cards showed.**

- The title reads at confidence 0.97 in about 110 to 160 ms, upright and
  turned. Vision takes about 30 ms for the same read.
- A whole-frame read finds the type line too.
- The 1080p corner text, about 16 pixels tall, is beyond Tesseract with or
  without inversion and upscaling.

On Tesseract the name read works and the corner pin from ADR 0027 does not.
Those scans go through the printing picker. A higher-resolution capture or a
crop before upload could change that later.

Engines declare whether they can read the corner, through `reads_corners` on
the protocol. Tesseract declares that it cannot, and the pipeline skips the
corner read on such an engine. A Linux scan pays for no fourth subprocess, and
a misread corner can never pin a printing there.

**Pillow becomes a runtime dependency on every platform.** It moves out of the
dev group. It is MIT-CMU licensed and about 5 MB. The adapter needs it, and
keeping it on the Mac keeps the option of running Tesseract there for
comparison.

## Alternatives

- **pytesseract.** It wraps the same subprocess call, writes temp files, and
  adds a package to save about 25 lines of TSV parsing.
- **tesserocr.** It binds the C++ API, needs a compiler to build, and has no
  Windows wheels.
- **The PaddleOCR models on ONNX.** ADR 0026 rejected this stack at 250 to
  350 MB. Moving to Linux and Windows does not change its size.
- **Letting the browser crop before upload.** A crop would hand Tesseract a
  larger title and corner. It changes the
  [ADR 0025](0025-scanner-capture-and-recognition-contract.md) contract, so it
  waits for later.

## Reasoning

Tesseract is the boring choice for a cross-platform engine. It has been
maintained for two decades, Homebrew and Debian package it, UB Mannheim builds
it for Windows, and it reads with no network call. The protocol from ADR 0026
let the adapter slot in beside Vision without touching the matcher, the
endpoint or the frontend. The pipeline changes only to skip the corner read on
an engine that declares it cannot read one. Running the binary as a
subprocess keeps the Python side to Pillow, which the lock file already held.

Vision stays first on a Mac because it reads the corner and Tesseract does
not, and it is several times faster.

## Consequences

- Linux and Windows read titles once Tesseract is installed.
- The ADR 0002 sidecar still has to bundle the binary and `eng.traineddata`,
  about 30 MB on macOS and 50 MB on Windows, and set `SCRIPTORIUM_TESSERACT`
  and `TESSDATA_PREFIX` when it spawns the backend. That is its own ticket.
- The corner pin needs Vision. On Tesseract the pipeline skips the corner
  read, and every scan goes through the printing picker.
- The test suite gains a `tesseract` marker. Its tests skip when the binary is
  absent. Every other Tesseract test fakes the subprocess.
- Tesseract accuracy on stylised title fonts and foils is untested beyond the
  drawn cards. The first real-card run on a non-Mac should record hit rates.
