"""Scanner endpoints (VEG-230, ADR 0025): read a card from a webcam still.

The Scry a Card page captures a still with the browser camera and posts the
image bytes here as the raw request body. Recognition itself arrives with
VEG-231 (OCR and fuzzy match). Until then the endpoint checks the image and
answers 501, and the page offers typing the name instead.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request

router = APIRouter(prefix="/scanner", tags=["scanner"])

MAX_IMAGE_BYTES = 12 * 1024 * 1024
ACCEPTED_TYPES = frozenset({"image/jpeg", "image/png"})

_TOO_LARGE_DETAIL = (
    f"The image is larger than {MAX_IMAGE_BYTES // (1024 * 1024)} MB. "
    "Capture at a lower resolution."
)


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
    the bytearray it was read into, so the image is held once, never copied.
    """
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > MAX_IMAGE_BYTES:
            raise HTTPException(status_code=413, detail=_TOO_LARGE_DETAIL)
    return body


@router.post("/recognize")
async def recognize(request: Request) -> dict[str, Any]:
    """Read the card name from a still image sent as the raw request body.

    The request carries image/jpeg or image/png bytes with a matching
    Content-Type. Parameters on the header, such as ``; charset=``, are
    ignored. Any other type answers 415, an empty body 400, and a body over
    MAX_IMAGE_BYTES 413. The type is checked first. A declared Content-Length
    over the cap answers 413 before any of the body is read, and the read
    itself stops with a 413 once the bytes pass the cap. The empty check runs
    on the bytes that were read.

    The contract VEG-231 fills answers 200 with
    ``{"readings": [{"name": str, "confidence": float}]}``. Readings are card
    names, best first, with confidence from 0 to 1, and the list is empty
    when nothing could be read. The browser turns a name into a folio with
    its printing picker. Until VEG-231 replaces it, every valid image
    answers 501.
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
    raise HTTPException(
        status_code=501,
        detail="The scriptorium cannot yet read a card by sight. Type its name instead.",
    )
