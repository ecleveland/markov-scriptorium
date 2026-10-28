"""OCR engine selection (VEG-231, ADR 0026).

``SCRIPTORIUM_OCR`` picks the engine. ``auto``, the default, uses Apple Vision
on macOS and no engine elsewhere. ``vision`` insists on Vision and fails
loudly when it cannot load. ``none`` turns recognition off, so the page offers
typing the name.
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


@functools.cache
def select_engine() -> Ocr | None:
    """The configured OCR engine, or None when recognition is off or unsupported.

    Raises OcrUnavailable for an unknown setting, or when ``vision`` is asked
    for and will not load. The choice is made once per process.
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
    if choice != "auto":
        raise OcrUnavailable(
            f"SCRIPTORIUM_OCR={choice!r} is not an engine; use auto, vision or none"
        )
    if sys.platform != "darwin":
        logger.info("OCR engine: none (no engine for %s)", sys.platform)
        return None
    try:
        engine = _vision()
    except ImportError:
        logger.info("OCR engine: none (Vision will not load)", exc_info=True)
        return None
    logger.info("OCR engine: vision")
    return engine
