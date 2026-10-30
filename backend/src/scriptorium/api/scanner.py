"""Scanner endpoints (VEG-230, VEG-231, VEG-653, ADR 0025 to 0027): read a card from a still.

The Scry a Card page captures a still with the browser camera and posts the
image bytes here as the raw request body. The endpoint checks the image, reads
its title bar with the OCR engine, and fuzzy matches the text against card
names in the local catalog. After a confident name it reads the card's corner
too, and when the collector number and set code name exactly one printing of
a name it read, that reading carries the printing so the page can skip its
printing picker. Otherwise the page turns a name into a folio with the
picker, and always offers typing the name instead. A failure on the corner
never costs the name. The readings still answer, with no printing.
"""

from __future__ import annotations

import asyncio
import io
import logging
import sqlite3
from contextlib import closing
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request
from PIL import Image

from scriptorium import catalog, db
from scriptorium.scanner import pipeline
from scriptorium.scanner.engines import select_engine
from scriptorium.scanner.names import name_index
from scriptorium.scanner.ocr import Ocr, OcrUnavailable, UnreadableImage
from scriptorium.scanner.printing import CornerRead

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


def _pin(kept: list[dict[str, Any]]) -> dict[str, Any] | None:
    # The corner reads "EN" on an English card. A printing in another
    # language at the same pair is a different folio the user did not hold.
    english = [row for row in kept if row["lang"] == "en"]
    if english:
        kept = english
    return kept[0] if len(kept) == 1 else None


def _pinned_printing(readings: list[pipeline.Reading], corner: CornerRead) -> dict[str, Any] | None:
    """The one printing at the corner's set and a number that a reading names.

    The name read stays primary. Only readings at ACCEPT can take a printing,
    so a misread corner cannot land on a doubtful name. A corner misread onto
    another card's number pins nothing, and a pair that still holds several
    printings of the name leaves the choice to the picker, and so does a
    promo or List reprint that prints the same corner. The number candidates
    are tried best first, and the first that pins wins.
    """
    names = {r.name for r in readings if r.confidence >= pipeline.ACCEPT}
    if not names:
        logger.debug(
            "no reading at ACCEPT; corner %s %s not looked up",
            corner.set_code,
            corner.collector_numbers,
        )
        return None
    try:
        with closing(db.connect()) as conn:
            for number in corner.collector_numbers:
                rows = catalog.printings_by_number(conn, corner.set_code, number)
                kept = [row for row in rows if row["name"] in names]
                logger.debug(
                    "corner %s %s: %d printings in the catalog, %d of a name read",
                    corner.set_code,
                    number,
                    len(rows),
                    len(kept),
                )
                pinned = _pin(kept)
                if pinned is None:
                    continue
                if catalog.has_sibling_printings(
                    conn, pinned["name"], pinned["scryfall_id"], corner.set_code, number
                ):
                    # The corner matches this printing and one that prints
                    # the same corner, so the picker has to ask.
                    logger.debug(
                        "corner %s %s matches %s and a sibling; no printing pinned",
                        corner.set_code,
                        number,
                        pinned["scryfall_id"],
                    )
                    return None
                logger.debug(
                    "corner %s %s pinned %s", corner.set_code, number, pinned["scryfall_id"]
                )
                return pinned
            logger.debug("corner %s %s pinned nothing", corner.set_code, corner.collector_numbers)
    except sqlite3.Error:
        # The name index read the catalog a moment ago, so this is most likely
        # the nightly refresh's write lock. The picker still finds the printing.
        logger.warning("the corner's printing lookup failed; no printing pinned", exc_info=True)
    return None


def _log_frame(image: bytes) -> None:
    # Image.open reads only the header, so the size costs no decode. The
    # engine judges the bytes, so a frame Pillow cannot place still goes on.
    try:
        width, height = Image.open(io.BytesIO(image)).size
    except Exception:
        logger.debug("frame: %d bytes, size unknown", len(image))
        return
    logger.debug("frame: %d bytes, %dx%d", len(image), width, height)


def _read_card(image: bytes, ocr: Ocr) -> list[dict[str, Any]]:
    # name_index and the printing lookup open SQLite, and name_index may
    # rebuild, so they run on the worker thread with the OCR, never on the
    # event loop.
    if logger.isEnabledFor(logging.DEBUG):
        _log_frame(image)
    result = pipeline.recognize(image, ocr, name_index())
    printing = None
    if result.corner is not None:
        printing = _pinned_printing(result.readings, result.corner)
    pinned_name = printing["name"] if printing is not None else None
    rows: list[dict[str, Any]] = []
    for reading in result.readings:
        # Reading names are unique, so at most one reading carries it.
        attached = printing if reading.name == pinned_name else None
        rows.append({"name": reading.name, "confidence": reading.confidence, "printing": attached})
    return rows


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
    ``{"readings": [{"name": str, "confidence": float, "printing": dict | None}]}``.
    Readings are full card names as ``cards.name`` holds them, best first,
    with confidence from 0 to 1, and the list is empty when nothing matched.
    ``printing`` is the catalog row the card's corner pinned, in the shape the
    printing picker lists, on the one reading it belongs to. Every other
    reading carries None.
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
        logger.exception("the scanner could not read the catalog")
        raise HTTPException(status_code=503, detail=ENGINE_FAILED_DETAIL) from None
    return {"readings": readings}
