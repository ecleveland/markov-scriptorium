"""The OCR engine interface the recognition pipeline reads through (VEG-231, ADR 0026).

Engines take the encoded image bytes as posted, so the pipeline never decodes
an image itself. Apple Vision is the first engine. Others can follow behind
the same protocol.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True, slots=True)
class Box:
    """A rectangle in fractions of the image, origin at the top left."""

    x: float
    y: float
    width: float
    height: float


@dataclass(frozen=True, slots=True)
class TextLine:
    """One line of text the engine read, with its place in the frame."""

    text: str
    # 0 to 1 as the engine reports it. Vision's is coarse, so the pipeline
    # weighs it lightly against the name match.
    confidence: float
    box: Box


class Ocr(Protocol):
    """Reads lines of text from an encoded JPEG or PNG."""

    name: str
    # Whether the engine can read the corner's collector number and set code,
    # 16 px text on a 1080p frame. The pipeline skips the corner read when it
    # cannot, so the picker finds the printing instead.
    reads_corners: bool

    def read_lines(
        self, image: bytes, *, upside_down: bool = False, region: Box | None = None
    ) -> list[TextLine]:
        """Read the lines in ``region`` of the frame, or all of it when None.

        ``upside_down`` asks the engine to turn the image half a turn first.
        Then both ``region`` and the returned boxes are in the turned frame,
        which is why the pipeline passes the same title region on both
        passes. Boxes come back in fractions of the whole frame, top-left
        origin, whatever the region.

        Raises UnreadableImage for bytes the engine cannot decode or will not
        accept, such as an image over Tesseract's pixel cap. The API answers
        that with a 400. Raises OcrUnavailable when the engine fails to run,
        which the API answers with a 503. No other exception may escape,
        because the handler maps only these two.
        """
        ...


class OcrUnavailable(Exception):
    """No engine could be selected, or the engine failed to run."""


class UnreadableImage(Exception):
    """The engine could not decode the image bytes."""
