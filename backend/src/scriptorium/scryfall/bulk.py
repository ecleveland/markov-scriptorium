"""Download Scryfall bulk-data exports into the local catalog data directory.

Scryfall publishes daily bulk JSON exports; per CLAUDE.md the app sources card
data from these (not live per-card API calls) and serves all reads locally. We
fetch the ``default_cards`` export — one row per *printing*, the grain the
``cards`` table needs — and store it compressed for the importer (VEG-213).

Flow:

1. ``GET https://api.scryfall.com/bulk-data`` and pick the entry by ``type``.
2. Stream the entry's ``download_uri`` (hosted on a separate data host) to disk,
   writing the raw gzip bytes as-is so the ~547 MB file never has to be
   decompressed in memory.

The file is named from Scryfall's ``updated_at`` so a given version is written
once; re-running with the same version on disk is a no-op (true staleness-driven
refresh is VEG-214).
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import httpx

from scriptorium import db

# Scryfall requires a descriptive User-Agent and an Accept header on API
# requests, and asks for ~50–100 ms between requests. See
# https://scryfall.com/docs/api and CLAUDE.md "Scryfall Integration".
USER_AGENT = "MarkovScriptorium/0.1 (https://github.com/ecleveland/markov-scriptorium)"
ACCEPT = "application/json"
BULK_DATA_ENDPOINT = "https://api.scryfall.com/bulk-data"
DEFAULT_BULK_TYPE = "default_cards"

_REQUEST_DELAY_SECONDS = 0.1
# The list call is quick; the bulk file is large, so allow a generous read
# window while still bounding connect time.
_TIMEOUT = httpx.Timeout(30.0, read=600.0)


class ScryfallBulkError(RuntimeError):
    """Raised when Scryfall bulk data can't be located or downloaded."""


@dataclass(frozen=True)
class BulkDataEntry:
    """A single entry from Scryfall's ``/bulk-data`` listing."""

    bulk_type: str
    name: str
    download_uri: str
    updated_at: str
    size: int
    content_encoding: str | None


def _new_client() -> httpx.Client:
    """An httpx client identifying this app via User-Agent on every request.

    ``Accept: application/json`` is *not* a client default: Scryfall asks that
    its API headers not be sent to the bulk download host (``data.scryfall.io``),
    so the list call adds ``Accept`` per-request instead.
    """
    return httpx.Client(
        headers={"User-Agent": USER_AGENT},
        timeout=_TIMEOUT,
        follow_redirects=True,
    )


def _throttle() -> None:
    """Pause between requests to respect Scryfall's rate-limit guidance."""
    time.sleep(_REQUEST_DELAY_SECONDS)


def _default_data_dir() -> Path:
    """Where bulk files live: a ``scryfall/`` dir beside the catalog database."""
    return db.db_path().parent / "scryfall"


def _compact_timestamp(iso: str) -> str:
    """Render an ISO-8601 timestamp as a filesystem-safe UTC stamp.

    ``2026-06-14T21:09:38.189+00:00`` -> ``20260614T210938Z``.
    """
    return datetime.fromisoformat(iso).astimezone(UTC).strftime("%Y%m%dT%H%M%SZ")


def _filename(entry: BulkDataEntry) -> str:
    suffix = ".json.gz" if entry.content_encoding == "gzip" else ".json"
    return f"{entry.bulk_type}-{_compact_timestamp(entry.updated_at)}{suffix}"


def _is_complete(path: Path, entry: BulkDataEntry) -> bool:
    """Best-effort check that an existing file is a complete download.

    Compares the on-disk size against Scryfall's reported ``size`` so a
    truncated or zero-byte file left by a past failure is re-downloaded rather
    than trusted by filename alone. When ``size`` is unknown (0), fall back to
    trusting the version-stamped name.
    """
    if not entry.size:
        return True
    try:
        return path.stat().st_size == entry.size
    except OSError:
        return False


def fetch_bulk_entry(
    bulk_type: str = DEFAULT_BULK_TYPE, *, client: httpx.Client | None = None
) -> BulkDataEntry:
    """Return the ``/bulk-data`` listing entry for ``bulk_type``.

    Raises :class:`ScryfallBulkError` if the request fails or no entry of that
    type exists.
    """
    owns_client = client is None
    http = client or _new_client()
    try:
        _throttle()
        # Accept is sent only here (the API host), not to the download host.
        response = http.get(BULK_DATA_ENDPOINT, headers={"Accept": ACCEPT})
        response.raise_for_status()
        payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        # ValueError covers a non-JSON body (json.JSONDecodeError) on a 200 —
        # e.g. an HTML error page from an intermediary.
        raise ScryfallBulkError(f"failed to fetch Scryfall bulk-data list: {exc}") from exc
    finally:
        if owns_client:
            http.close()

    if not isinstance(payload, dict):
        raise ScryfallBulkError("unexpected Scryfall bulk-data response (not a JSON object)")

    for entry in payload.get("data", []):
        if entry.get("type") == bulk_type:
            try:
                return BulkDataEntry(
                    bulk_type=entry["type"],
                    name=entry.get("name", entry["type"]),
                    download_uri=entry["download_uri"],
                    updated_at=entry["updated_at"],
                    size=entry.get("size", 0),
                    content_encoding=entry.get("content_encoding"),
                )
            except KeyError as exc:
                raise ScryfallBulkError(
                    f"malformed Scryfall bulk-data entry for {bulk_type!r}: missing {exc}"
                ) from exc
    raise ScryfallBulkError(f"no Scryfall bulk-data entry of type {bulk_type!r}")


def download_bulk(
    bulk_type: str = DEFAULT_BULK_TYPE,
    *,
    dest_dir: Path | None = None,
    client: httpx.Client | None = None,
) -> Path:
    """Download ``bulk_type`` to ``dest_dir`` and return the stored file path.

    Streams the raw (gzip) bytes to a temporary ``.partial`` file, then renames
    it into place so an interrupted download never looks complete. If the file
    for this exact version already exists, returns it without re-downloading.
    """
    owns_client = client is None
    http = client or _new_client()
    try:
        entry = fetch_bulk_entry(bulk_type, client=http)
        directory = dest_dir or _default_data_dir()
        directory.mkdir(parents=True, exist_ok=True)
        target = directory / _filename(entry)
        if target.exists() and _is_complete(target, entry):
            return target

        partial = directory / f"{target.name}.partial"
        try:
            _throttle()
            written = 0
            with http.stream("GET", entry.download_uri) as response:
                response.raise_for_status()
                with partial.open("wb") as fh:
                    for chunk in response.iter_raw():
                        written += fh.write(chunk)
            # Guard against a clean-but-truncated transfer (connection dropped
            # without an HTTP error) being promoted to the canonical file.
            if entry.size and written != entry.size:
                raise ScryfallBulkError(
                    f"truncated download for {bulk_type}: "
                    f"expected {entry.size} bytes, got {written}"
                )
            partial.replace(target)
        except (httpx.HTTPError, OSError) as exc:
            # Transport error, disk-full during write, or a failed rename — none
            # should leave a stray partial behind.
            partial.unlink(missing_ok=True)
            raise ScryfallBulkError(
                f"failed to download {bulk_type} from {entry.download_uri}: {exc}"
            ) from exc
        except ScryfallBulkError:
            partial.unlink(missing_ok=True)
            raise
        return target
    finally:
        if owns_client:
            http.close()
