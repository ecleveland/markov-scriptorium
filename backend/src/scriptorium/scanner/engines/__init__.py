"""OCR engine selection (VEG-231, ADR 0026, VEG-649, ADR 0028).

``SCRIPTORIUM_OCR`` picks the engine. ``auto``, the default, uses Apple Vision
on macOS and Tesseract elsewhere when its binary is found. ``vision`` and
``tesseract`` insist on that engine and fail loudly when it cannot load.
``none`` turns recognition off, so the page offers typing the name.
"""

from __future__ import annotations

import functools
import logging
import os
import sys

from scriptorium.scanner.ocr import Ocr, OcrUnavailable

logger = logging.getLogger(__name__)


def _vision() -> Ocr:
    # Imported here so pyobjc loads only where Vision is wanted.
    from scriptorium.scanner.engines.vision import VisionOcr

    return VisionOcr()


def _tesseract() -> Ocr:
    """A Tesseract engine whose binary runs and has the eng model.

    Raises OcrUnavailable saying which of the two is missing.
    """
    # Imported here so Pillow loads only where Tesseract is wanted.
    from scriptorium.scanner.engines.tesseract import TesseractOcr, find_tesseract, probe

    binary = find_tesseract()
    if binary is None:
        raise OcrUnavailable(
            "no tesseract binary was found; set SCRIPTORIUM_TESSERACT or install it "
            "(brew install tesseract, apt install tesseract-ocr)"
        )
    if probe(binary) is None:
        raise OcrUnavailable(
            f"the tesseract at {binary} failed its probe; it would not run or has no eng model"
        )
    return TesseractOcr(binary)


@functools.cache
def select_engine() -> Ocr | None:
    """The configured OCR engine, or None when recognition is off or unsupported.

    Raises OcrUnavailable for an unknown setting, or when ``vision`` or
    ``tesseract`` is asked for and will not load. The choice is made once per
    process.
    """
    choice = os.environ.get("SCRIPTORIUM_OCR", "auto").strip().lower() or "auto"
    if choice == "none":
        logger.info("OCR engine: none (SCRIPTORIUM_OCR=none)")
        return None
    if choice == "vision":
        try:
            engine = _vision()
        except ImportError as exc:
            raise OcrUnavailable(f"SCRIPTORIUM_OCR=vision but Vision will not load: {exc}") from exc
        logger.info("OCR engine: vision")
        return engine
    if choice == "tesseract":
        try:
            engine = _tesseract()
        except OcrUnavailable as exc:
            raise OcrUnavailable(f"SCRIPTORIUM_OCR=tesseract but {exc}") from exc
        logger.info("OCR engine: tesseract")
        return engine
    if choice != "auto":
        raise OcrUnavailable(
            f"SCRIPTORIUM_OCR={choice!r} is not an engine; use auto, vision, tesseract or none"
        )
    if sys.platform != "darwin":
        # Vision is better on a Mac, so Tesseract is chosen only off macOS.
        try:
            engine = _tesseract()
        except OcrUnavailable as exc:
            logger.info("OCR engine: none on %s, because %s", sys.platform, exc)
            return None
        logger.info("OCR engine: tesseract")
        return engine
    try:
        engine = _vision()
    except ImportError:
        logger.info("OCR engine: none (Vision will not load)", exc_info=True)
        return None
    logger.info("OCR engine: vision")
    return engine
