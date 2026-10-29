"""Tesseract OCR engine (VEG-649, ADR 0028).

Tesseract runs as a subprocess on the PNG this module prepares. The CLI
cannot turn, crop or upscale an image, so the adapter does all three with
Pillow and maps the boxes Tesseract reports in the prepared crop back to
fractions of the whole frame.
"""

from __future__ import annotations

import io
import logging
import os
import shutil
import subprocess
from dataclasses import dataclass

from PIL import Image, ImageOps, UnidentifiedImageError

from scriptorium.scanner.ocr import Box, OcrUnavailable, TextLine, UnreadableImage

logger = logging.getLogger(__name__)

# Tesseract reads small text poorly. A title region is about a quarter title
# bar, so scaling the crop to 480 px tall makes the title about 120 px.
_TARGET_HEIGHT = 480
_MAX_SCALE = 4.0
# Text touching the edge of the image reads worse, so the crop gets a margin.
_BORDER = 20
_TIMEOUT_SECONDS = 10
# Listing the models is quick, and selection waits on it at startup.
_PROBE_TIMEOUT_SECONDS = 5
# Windows only. It keeps the sidecar from flashing a console on every read.
_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)
# A 4K frame is about 8 million pixels. Five times that leaves room for any
# camera, and refusing more keeps a hostile header from costing gigabytes.
_MAX_PIXELS = 40_000_000
# The TSV's level for a single word. Page, block, paragraph and line rows
# carry conf -1 and no text.
_WORD_LEVEL = "5"
# Enough of stderr to carry the cause. A missing model prints five lines and
# "Failed loading language" is the third, not the last.
_STDERR_LINES = 5


@dataclass(frozen=True, slots=True)
class PixelBox:
    """A rectangle in pixels of the prepared crop, as Tesseract reports it."""

    left: int
    top: int
    width: int
    height: int


@dataclass(frozen=True, slots=True)
class Word:
    """One level 5 row of Tesseract's TSV."""

    block: int
    par: int
    line: int
    text: str
    conf: float
    left: int
    top: int
    width: int
    height: int


@dataclass(frozen=True, slots=True)
class Prepared:
    """The PNG handed to Tesseract and what it takes to undo the prep."""

    png: bytes
    scale: float
    border: int


def find_tesseract() -> str | None:
    """``SCRIPTORIUM_TESSERACT`` when set, else the tesseract on PATH, else None."""
    configured = os.environ.get("SCRIPTORIUM_TESSERACT", "").strip()
    if configured:
        return configured
    return shutil.which("tesseract")


def probe(binary: str) -> None:
    """Check that ``binary`` runs and lists the eng model.

    Selection probes once at startup, so a stale path or a missing model
    fails there and not on the first scan. Raises OcrUnavailable naming the
    path and the cause.
    """
    try:
        result = subprocess.run(
            [binary, "--list-langs"],
            capture_output=True,
            timeout=_PROBE_TIMEOUT_SECONDS,
            creationflags=_NO_WINDOW,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise OcrUnavailable(
            f"the tesseract at {binary} would not run or timed out: {exc}"
        ) from exc
    if result.returncode != 0:
        raise OcrUnavailable(
            f"the tesseract at {binary} exited {result.returncode} while listing languages"
        )
    # Tesseract 5 lists the models on stdout, older releases on stderr.
    listed = (result.stdout + b"\n" + result.stderr).decode(errors="replace")
    if "eng" not in {ln.strip() for ln in listed.splitlines()}:
        raise OcrUnavailable(f"the tesseract at {binary} has no eng model among its languages")


def prepare(crop: Image.Image) -> Prepared:
    """Grey a crop, upscale it if short, stretch its contrast and pad it in white."""
    # Tesseract greys the image itself. Greying first keeps autocontrast from
    # stretching each colour channel apart, and makes the resize a third of
    # the work.
    try:
        crop = crop.convert("L")
    except (OSError, ValueError) as exc:
        # Pillow decodes some modes it cannot convert, LAB among them.
        raise UnreadableImage(f"Pillow could not grey a {crop.mode} image: {exc}") from exc
    scale = min(_MAX_SCALE, max(1.0, _TARGET_HEIGHT / crop.height))
    if scale > 1.0:
        size = (round(crop.width * scale), round(crop.height * scale))
        crop = crop.resize(size, Image.Resampling.LANCZOS)
    # A webcam frame is low contrast. Cutting the extreme percent keeps a
    # glint or a shadow from setting the range.
    crop = ImageOps.autocontrast(crop, cutoff=1)
    crop = ImageOps.expand(crop, border=_BORDER, fill="white")
    out = io.BytesIO()
    crop.save(out, format="PNG")
    return Prepared(png=out.getvalue(), scale=scale, border=_BORDER)


def parse_tsv(text: str) -> list[Word]:
    """The words in Tesseract's TSV that carry a confidence and some text."""
    words: list[Word] = []
    for row in text.splitlines()[1:]:
        fields = row.split("\t")
        if len(fields) < 12 or fields[0] != _WORD_LEVEL:
            continue
        try:
            conf = float(fields[10])
            block, par, line = (int(v) for v in fields[2:5])
            left, top, width, height = (int(v) for v in fields[6:10])
        except ValueError:
            # A locale can print "96,5". One bad row should not cost the rest.
            continue
        word = fields[11].strip()
        if conf < 0 or not word:
            continue
        words.append(Word(block, par, line, word, conf, left, top, width, height))
    return words


def group_lines(words: list[Word]) -> list[tuple[str, float, PixelBox]]:
    """Join words into lines in the order Tesseract read them.

    Each line's confidence is its words' mean, over 100 to match the
    protocol's 0 to 1, and its box is the union of theirs.
    """
    grouped: dict[tuple[int, int, int], list[Word]] = {}
    for word in words:
        grouped.setdefault((word.block, word.par, word.line), []).append(word)
    lines: list[tuple[str, float, PixelBox]] = []
    for members in grouped.values():
        text = " ".join(w.text for w in members)
        confidence = sum(w.conf for w in members) / len(members) / 100
        left = min(w.left for w in members)
        top = min(w.top for w in members)
        right = max(w.left + w.width for w in members)
        bottom = max(w.top + w.height for w in members)
        lines.append((text, confidence, PixelBox(left, top, right - left, bottom - top)))
    return lines


def to_frame(
    px: PixelBox, scale: float, border: int, origin: tuple[int, int], frame: tuple[int, int]
) -> Box:
    """Map a box in the prepared crop back to fractions of the whole frame.

    Each edge is clamped into the frame, because Tesseract can report a box
    that reaches into the white border.
    """
    ox, oy = origin
    fw, fh = frame
    left = _unit(((px.left - border) / scale + ox) / fw)
    top = _unit(((px.top - border) / scale + oy) / fh)
    right = _unit(((px.left + px.width - border) / scale + ox) / fw)
    bottom = _unit(((px.top + px.height - border) / scale + oy) / fh)
    return Box(x=left, y=top, width=max(right - left, 0.0), height=max(bottom - top, 0.0))


def _unit(value: float) -> float:
    return min(max(value, 0.0), 1.0)


def _decode(image: bytes) -> Image.Image:
    try:
        decoded = Image.open(io.BytesIO(image))
        # open() reads only the header, so the size is known before the body
        # is decoded into memory.
        width, height = decoded.size
        if width * height > _MAX_PIXELS:
            raise UnreadableImage(
                f"the image is {width}x{height}, over the cap of {_MAX_PIXELS:,} pixels"
            )
        # load() decodes, so a truncated or corrupt body fails here and not
        # inside the crop.
        decoded.load()
    # Pillow reports a damaged PNG chunk as SyntaxError, not as OSError.
    except (
        UnidentifiedImageError,
        Image.DecompressionBombError,
        OSError,
        SyntaxError,
        ValueError,
    ) as exc:
        raise UnreadableImage(f"Pillow could not decode the image: {exc}") from exc
    # Left in its own mode. prepare() greys the crop, which is less to convert.
    return decoded


def _crop_box(region: Box, frame: tuple[int, int]) -> tuple[int, int, int, int] | None:
    """``region`` in pixels, clamped to the frame, or None when nothing is left."""
    fw, fh = frame
    left = min(max(round(region.x * fw), 0), fw)
    top = min(max(round(region.y * fh), 0), fh)
    right = min(max(round((region.x + region.width) * fw), 0), fw)
    bottom = min(max(round((region.y + region.height) * fh), 0), fh)
    if right <= left or bottom <= top:
        return None
    return (left, top, right, bottom)


class TesseractOcr:
    """Reads text by running the tesseract CLI with the eng LSTM model."""

    name = "tesseract"
    # Tesseract never reads the collector number in the 16 px corner text,
    # so the pipeline leaves the printing to the picker (ADR 0028).
    reads_corners = False

    def __init__(self, binary: str) -> None:
        self.binary = binary

    def read_lines(
        self, image: bytes, *, upside_down: bool = False, region: Box | None = None
    ) -> list[TextLine]:
        frame = _decode(image)
        # Turned before the crop, because the protocol puts the region and
        # the boxes in the turned frame.
        if upside_down:
            frame = frame.rotate(180)
        size = frame.size
        if region is None:
            crop, origin = frame, (0, 0)
        else:
            box = _crop_box(region, size)
            if box is None:
                return []
            crop, origin = frame.crop(box), (box[0], box[1])
        prepared = prepare(crop)
        # A region is one block of text. The whole frame is scattered lines,
        # which psm 6 would merge across the card.
        psm = "6" if region is not None else "11"
        stdout = self._run(prepared.png, psm)
        return [
            TextLine(
                text=text,
                confidence=confidence,
                box=to_frame(px, prepared.scale, prepared.border, origin, size),
            )
            for text, confidence, px in group_lines(parse_tsv(stdout))
        ]

    def _run(self, png: bytes, psm: str) -> str:
        argv = [
            self.binary,
            "stdin",
            "stdout",
            "-l",
            "eng",
            "--oem",
            "1",
            "--psm",
            psm,
            "-c",
            "tessedit_create_tsv=1",
        ]
        try:
            result = subprocess.run(
                argv,
                input=png,
                capture_output=True,
                timeout=_TIMEOUT_SECONDS,
                # One thread per read. OpenMP threads add overhead on an image
                # this small, and parallel reads would oversubscribe the cores.
                env={**os.environ, "OMP_THREAD_LIMIT": "1"},
                creationflags=_NO_WINDOW,
            )
        except OSError as exc:
            # Missing, not executable, or the wrong format for this machine.
            logger.error("Tesseract at %s would not run: %s", self.binary, exc)
            raise OcrUnavailable(f"Tesseract at {self.binary} would not run: {exc}") from exc
        except subprocess.TimeoutExpired as exc:
            logger.error("Tesseract at %s took over %ss", self.binary, _TIMEOUT_SECONDS)
            raise OcrUnavailable(
                f"Tesseract at {self.binary} took over {_TIMEOUT_SECONDS}s"
            ) from exc
        if result.returncode != 0:
            stderr = result.stderr.decode(errors="replace")
            logger.error(
                "Tesseract at %s exited %d: %s", self.binary, result.returncode, stderr.strip()
            )
            tail = [ln.strip() for ln in stderr.splitlines() if ln.strip()][-_STDERR_LINES:]
            raise OcrUnavailable(
                f"Tesseract at {self.binary} exited {result.returncode}: {'; '.join(tail)}"
            )
        return result.stdout.decode(errors="replace")
