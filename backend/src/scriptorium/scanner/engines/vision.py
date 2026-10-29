"""Apple Vision OCR engine (VEG-231, ADR 0026).

The only module that imports pyobjc. Every value crossing back from
Objective-C goes through ``str()`` or ``float()`` here, so the rest of the
pipeline sees plain Python and mypy stays strict.
"""

from __future__ import annotations

import logging

import Foundation
import objc
import Quartz
import Vision

from scriptorium.scanner.ocr import Box, OcrUnavailable, TextLine, UnreadableImage
from scriptorium.scanner.region import to_bottom_left, to_top_left, unscale

logger = logging.getLogger(__name__)

# CGImagePropertyOrientation values. Vision turns the image before reading, so
# boxes come back in the upright frame.
_UP = 1
_DOWN = 3


class VisionOcr:
    """Reads text with VNRecognizeTextRequest at the accurate level."""

    name = "vision"
    reads_corners = True

    def read_lines(
        self, image: bytes, *, upside_down: bool = False, region: Box | None = None
    ) -> list[TextLine]:
        # The pool frees the Objective-C objects each read makes, which would
        # otherwise pile up on a worker thread with no run loop to drain them.
        with objc.autorelease_pool():
            try:
                return self._read(image, upside_down=upside_down, region=region)
            except objc.error as exc:
                raise OcrUnavailable(f"Vision failed: {exc}") from exc

    def _read(self, image: bytes, *, upside_down: bool, region: Box | None) -> list[TextLine]:
        data = Foundation.NSData.dataWithBytes_length_(image, len(image))
        _check_decodes(data)
        handler = Vision.VNImageRequestHandler.alloc().initWithData_orientation_options_(
            data, _DOWN if upside_down else _UP, None
        )
        request = Vision.VNRecognizeTextRequest.alloc().init()
        request.setRecognitionLevel_(Vision.VNRequestTextRecognitionLevelAccurate)
        # Card names are not dictionary words, and correction "fixes" them.
        request.setUsesLanguageCorrection_(False)
        request.setRecognitionLanguages_(["en-US"])
        if region is not None:
            request.setRegionOfInterest_(to_bottom_left(region))
        result = handler.performRequests_error_([request], None)
        ok, error = result if isinstance(result, tuple) else (result, None)
        if not ok:
            # The bytes decoded above, so this is Vision itself failing, not
            # the capture. Asking the user to capture again would not help.
            logger.error("Vision text recognition failed: %s", error)
            raise OcrUnavailable(f"Vision text recognition failed: {error}")
        lines: list[TextLine] = []
        for observation in request.results() or []:
            candidates = observation.topCandidates_(1)
            if not candidates:
                continue
            candidate = candidates[0]
            bounds = observation.boundingBox()
            box = to_top_left(
                float(bounds.origin.x),
                float(bounds.origin.y),
                float(bounds.size.width),
                float(bounds.size.height),
            )
            # With a region set, Vision measures boxes inside the region.
            if region is not None:
                box = unscale(box, region)
            lines.append(
                TextLine(
                    text=str(candidate.string()), confidence=float(candidate.confidence()), box=box
                )
            )
        return lines


def _check_decodes(data: object) -> None:
    """Raise UnreadableImage unless ImageIO can decode a first frame from ``data``.

    Vision reports a bad image and its own failures the same way, so the
    decode is checked first to tell the user's capture from the engine.
    """
    source = Quartz.CGImageSourceCreateWithData(data, None)
    if source is None or Quartz.CGImageSourceGetCount(source) == 0:
        raise UnreadableImage("ImageIO found no image in the bytes")
    if Quartz.CGImageSourceCreateImageAtIndex(source, 0, None) is None:
        raise UnreadableImage("ImageIO could not decode the image")
