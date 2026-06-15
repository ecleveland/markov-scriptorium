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
from scriptorium.scryfall.importer import (
    BulkImportError,
    ImportResult,
    import_bulk_file,
)

__all__ = [
    "BulkDataEntry",
    "BulkImportError",
    "ImportResult",
    "ScryfallBulkError",
    "download_bulk",
    "fetch_bulk_entry",
    "import_bulk_file",
]
