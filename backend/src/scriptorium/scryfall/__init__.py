"""Scryfall integration: local bulk-data download, import, and lookup.

Per the project's Scryfall rules (CLAUDE.md), card data is sourced from
Scryfall's daily bulk exports and served from the local catalog — never from
live per-card API calls. This package houses that pipeline: ``bulk`` is the
downloader (VEG-212), ``importer`` loads a file into the catalog (VEG-213), and
``refresh`` orchestrates the two with a staleness gate (VEG-214).
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
from scriptorium.scryfall.refresh import (
    REFRESH_MAX_AGE,
    RefreshResult,
    RefreshStatus,
    is_stale,
    maybe_refresh,
    read_status,
    refresh_catalog,
)

__all__ = [
    "REFRESH_MAX_AGE",
    "BulkDataEntry",
    "BulkImportError",
    "ImportResult",
    "RefreshResult",
    "RefreshStatus",
    "ScryfallBulkError",
    "download_bulk",
    "fetch_bulk_entry",
    "import_bulk_file",
    "is_stale",
    "maybe_refresh",
    "read_status",
    "refresh_catalog",
]
