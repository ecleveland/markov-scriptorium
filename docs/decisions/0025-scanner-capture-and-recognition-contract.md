# 0025 Scanner capture and recognition contract

**Status:** accepted (2026-10-22)

Resolves [VEG-230]. Decides how the browser captures a card, how it sends the
image, and what the recognition endpoint answers. [VEG-231] fills the
recognition itself with OCR and a fuzzy name match, and this record fixes the
contract it fills.

[VEG-230]: https://linear.app/cleveland-family-enterprises/issue/VEG-230
[VEG-231]: https://linear.app/cleveland-family-enterprises/issue/VEG-231

---

## Decision

**Desktop webcam first, still capture.** The scanner targets a USB webcam on
the desktop. A phone camera comes later. The page captures one still and sends
it for processing. It does not try to recognize cards from the live feed.

**The page lives at `/scan`, titled "Scry a Card".**

**The browser captures and posts the raw bytes.** The page opens the camera
with `getUserMedia`, draws the current frame onto a canvas, and exports it as
JPEG at quality 0.92 at the camera's full resolution. The title bar OCR in
VEG-231 needs those pixels, so the page does not downscale. It posts the bytes
as the raw request body with the image's own Content-Type.

**The endpoint contract.** `POST /scanner/recognize` takes the image as the
body.

- It accepts `image/jpeg` and `image/png`. The backend compares the media type
  only, ignores parameters such as `; charset=`, and ignores case. Any other
  type, or no type, answers 415.
- A body over 12 MB answers 413. A declared Content-Length over the cap is
  refused before any of the body is read. Otherwise the backend reads the body
  in chunks and stops with the 413 as soon as the bytes pass the cap, so an
  oversized upload never sits whole in memory.
- An empty body answers 400.
- The checks run in that order.
- A 200 answers `{"readings": [{"name": str, "confidence": float}]}`, best
  first, with confidence from 0 to 1. The list is empty when nothing could be
  read.

Readings are card names, not printings. The browser already turns a name into
a folio with the printing picker and then the Inscribe form, and VEG-231 says
printing disambiguation is a prompt to the user.

**A stub answers 501 until VEG-231.** Every valid image gets a 501 with the
detail "The scriptorium cannot yet read a card by sight. Type its name
instead." The page shows that detail.

**The page always offers "Type the name instead".** A missed read, an empty
list, or the stub still ends in an inscription through the name search.

## Alternatives

- **Multipart upload.** The usual form upload needs the python-multipart
  dependency, and it buys nothing a raw body cannot do for one image.
- **Return printings with scores.** The server would rank set and collector
  number for each candidate. That duplicates the name search and the printing
  picker the browser already has.
- **No stub.** The page could treat a 404 as "not built yet". A 404 looks the
  same as a misrouted call, so a real routing bug would hide behind it.
- **Live recognition.** Reading cards from the moving feed needs perceptual
  hashing or repeated OCR calls. A still is enough for one card at a time.

## Reasoning

A raw body keeps the backend free of a new dependency and keeps the handler
small. The handler checks the type and counts the bytes as they arrive. Full
resolution costs a few megabytes per capture on a local connection, and the
12 MB cap still leaves room for a large webcam frame as JPEG. Names
keep the server's job to reading text, which is what OCR does well, and leave
the printing choice with the user, who has the card in hand.

Shipping the 501 now lets the capture page, its error handling, and the typed
fallback land and get used before recognition exists. VEG-231 then fills one
handler behind a contract that is already fixed.

## Consequences

- VEG-231 replaces the 501 in `backend/src/scriptorium/api/scanner.py` with
  real readings and keeps the status codes and the response shape.
- The camera needs a secure context. `http://localhost` counts as one, so the
  dev server works. Serving the app to a phone on the local network later
  needs HTTPS.
- A phone camera, batch scanning of several cards in one photo, and live
  recognition stay open. Each would need its own record if it changes this
  contract.
