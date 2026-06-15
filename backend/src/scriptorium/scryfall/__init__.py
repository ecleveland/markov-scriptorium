"""Scryfall integration: local bulk-data download, import, and lookup.

Per the project's Scryfall rules (CLAUDE.md), card data is sourced from
Scryfall's daily bulk exports and served from the local catalog — never from
live per-card API calls. This package houses that pipeline; ``bulk`` is the
downloader (VEG-212).
"""

from __future__ import annotations

from scriptorium.scryfall.bulk import (
    BulkDataEntry,
    ScryfallBulkError,
    download_bulk,
    fetch_bulk_entry,
)

__all__ = [
    "BulkDataEntry",
    "ScryfallBulkError",
    "download_bulk",
    "fetch_bulk_entry",
]
