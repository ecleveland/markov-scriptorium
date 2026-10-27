"""Scanner endpoints (VEG-230, VEG-231, ADR 0025, ADR 0026): read a card from a webcam still.

The Scry a Card page captures a still with the browser camera and posts the
image bytes here as the raw request body. The endpoint checks the image, reads
its title bar with the OCR engine, and fuzzy matches the text against card
names in the local catalog. The page turns a name into a folio with its
printing picker, and always offers typing the name instead.
"""

from __future__ import annotations

import asyncio
import logging
import sqlite3
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request

from scriptorium.scanner import pipeline
from scriptorium.scanner.engines import select_engine
from scriptorium.scanner.names import name_index
from scriptorium.scanner.ocr import Ocr, OcrUnavailable, UnreadableImage

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/scanner", tags=["scanner"])

MAX_IMAGE_BYTES = 12 * 1024 * 1024
ACCEPTED_TYPES = frozenset({"image/jpeg", "image/png"})

_TOO_LARGE_DETAIL = (
    f"The image is larger than {MAX_IMAGE_BYTES // (1024 * 1024)} MB. "
    "Capture at a lower resolution."
)
NO_ENGINE_DETAIL = "No scrying glass is fitted to this scriptorium. Type the name instead."
UNREADABLE_DETAIL = "The glass could not make sense of that image. Capture the card again."
ENGINE_FAILED_DETAIL = (
    "The glass clouded over while reading. Try the capture again, or type the name instead."
)


def get_ocr() -> Ocr | None:
    """The OCR engine for this process, or None when there is none.

    FastAPI resolves this before the handler checks the image, so it never
    raises. A misconfigured engine would otherwise turn every request,
    a text/plain one included, into a 500. It is logged and treated as no
    engine instead.
    """
    try:
        return select_engine()
    except OcrUnavailable:
        logger.exception("no OCR engine could be selected; recognition is off")
        return None


def _declared_length(request: Request) -> int | None:
    """The Content-Length the client declared, or None when absent or unreadable."""
    try:
        return int(request.headers["content-length"])
    except (KeyError, ValueError):
        return None


async def _read_capped(request: Request) -> bytearray:
    """Read the body chunk by chunk, refusing with a 413 once it passes the cap.

    The rest of an oversized body is never read, so a large upload costs at
    most one chunk beyond MAX_IMAGE_BYTES in memory. The body comes back as
    the bytearray it was read into, so reading never copies it. The engine
    takes bytes, so the handler makes the one copy recognition needs.
    """
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > MAX_IMAGE_BYTES:
            raise HTTPException(status_code=413, detail=_TOO_LARGE_DETAIL)
    return body


def _read_card(image: bytes, ocr: Ocr) -> list[pipeline.Reading]:
    # name_index opens SQLite and may rebuild, so it runs on the worker thread
    # with the OCR, never on the event loop.
    return pipeline.recognize(image, ocr, name_index())


@router.post("/recognize")
async def recognize(
    request: Request, ocr: Annotated[Ocr | None, Depends(get_ocr)]
) -> dict[str, Any]:
    """Read the card name from a still image sent as the raw request body.

    The request carries image/jpeg or image/png bytes with a matching
    Content-Type. Parameters on the header, such as ``; charset=``, are
    ignored. Any other type answers 415, an empty body 400, and a body over
    MAX_IMAGE_BYTES 413. The type is checked first. A declared Content-Length
    over the cap answers 413 before any of the body is read, and the read
    itself stops with a 413 once the bytes pass the cap. The empty check runs
    on the bytes that were read.

    Only then does recognition run. No engine answers 503, an image the
    engine cannot decode 400, and an engine that fails while reading, or a
    catalog that cannot be read, 503.
    Otherwise the answer is 200 with
    ``{"readings": [{"name": str, "confidence": float}]}``. Readings are full
    card names as ``cards.name`` holds them, best first, with confidence from
    0 to 1, and the list is empty when nothing matched.
    """
    media_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if media_type not in ACCEPTED_TYPES:
        raise HTTPException(status_code=415, detail="Send the card as a JPEG or PNG image.")
    declared = _declared_length(request)
    if declared is not None and declared > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail=_TOO_LARGE_DETAIL)
    body = await _read_capped(request)
    if not body:
        raise HTTPException(status_code=400, detail="The image was empty.")
    if ocr is None:
        raise HTTPException(status_code=503, detail=NO_ENGINE_DETAIL)
    try:
        readings = await asyncio.to_thread(_read_card, bytes(body), ocr)
    except UnreadableImage:
        raise HTTPException(status_code=400, detail=UNREADABLE_DETAIL) from None
    except OcrUnavailable:
        logger.exception("the OCR engine failed while reading a capture")
        raise HTTPException(status_code=503, detail=ENGINE_FAILED_DETAIL) from None
    except sqlite3.Error:
        # The nightly refresh can hold the catalog's write lock. The user can
        # retry or type the name, so this answers like a clouded glass.
        logger.exception("the name index could not read the catalog")
        raise HTTPException(status_code=503, detail=ENGINE_FAILED_DETAIL) from None
    return {"readings": [{"name": r.name, "confidence": r.confidence} for r in readings]}
