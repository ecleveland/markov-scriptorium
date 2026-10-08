"""Load a Scryfall bulk export into the local card catalog (VEG-213, ADR 0006).

Stream-parses the bulk JSON array one card object at a time (via ijson, so the
~1.5 GB decompressed file never lands in memory) and refreshes the ``cards`` /
``card_faces`` tables in a single transaction: a mid-import failure rolls back
and never leaves a half-loaded catalog. Cards are upserted, faces are replaced
per card, and a guarded sweep then deletes printings that left the export
unless inventory or a Tome still references them (VEG-575, ADR 0019). Field
mapping follows the schema in ADR 0005 — the importer owns the JSON
serialization of the blob columns (colors, legalities, image_uris, …) and the
price spread.
"""

from __future__ import annotations

import gzip
import json
import logging
import sqlite3
import zlib
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import IO, Any, cast

import ijson

from scriptorium.catalog import rebuild_name_index

logger = logging.getLogger("scriptorium")

# Rows per executemany. Big enough to amortize call overhead, small enough to
# bound the in-memory batch for a ~110k-card file.
_BATCH_SIZE = 5_000
_PROGRESS_EVERY = 25_000

_CARD_COLUMNS = (
    "scryfall_id",
    "oracle_id",
    "name",
    "set_code",
    "set_name",
    "collector_number",
    "rarity",
    "lang",
    "released_at",
    "layout",
    "mana_cost",
    "cmc",
    "type_line",
    "oracle_text",
    "colors",
    "color_identity",
    "finishes",
    "legalities",
    "image_uris",
    "price_usd",
    "price_usd_foil",
    "price_usd_etched",
    "price_eur",
    "price_eur_foil",
    "price_tix",
    "scryfall_uri",
)
_FACE_COLUMNS = (
    "scryfall_id",
    "face_index",
    "name",
    "mana_cost",
    "type_line",
    "oracle_text",
    "colors",
    "image_uris",
)

# Upsert keeps each existing row (and its rowid) in place, so a refresh never
# deletes a printing that inventory or a Tome references.
_UPSERT_CARD = (
    f"INSERT INTO cards ({', '.join(_CARD_COLUMNS)}) "
    f"VALUES ({', '.join('?' for _ in _CARD_COLUMNS)}) "
    f"ON CONFLICT(scryfall_id) DO UPDATE SET "
    f"{', '.join(f'{col} = excluded.{col}' for col in _CARD_COLUMNS[1:])}"
)
_INSERT_FACE = (
    f"INSERT INTO card_faces ({', '.join(_FACE_COLUMNS)}) "
    f"VALUES ({', '.join('?' for _ in _FACE_COLUMNS)})"
)


class BulkImportError(RuntimeError):
    """Raised when a Scryfall bulk file can't be parsed or loaded."""


@dataclass(frozen=True)
class ImportResult:
    """Counts from a completed import.

    ``retired`` counts printings that left the export and were deleted.
    ``kept`` counts printings that left the export but stayed because inventory
    or a Tome still references them.
    """

    cards: int
    faces: int
    retired: int = 0
    kept: int = 0


def _json_or_none(value: Any) -> str | None:
    """Serialize a JSON-able value to TEXT, preserving SQL NULL for absent fields."""
    return None if value is None else json.dumps(value, separators=(",", ":"))


def _card_row(card: dict[str, Any]) -> tuple[Any, ...]:
    prices = card.get("prices") or {}
    return (
        card["id"],
        card.get("oracle_id"),
        card["name"],
        card["set"],
        card["set_name"],
        card["collector_number"],
        card["rarity"],
        card["lang"],
        card.get("released_at"),
        card["layout"],
        card.get("mana_cost"),
        card.get("cmc"),
        card.get("type_line"),
        card.get("oracle_text"),
        _json_or_none(card.get("colors")),
        _json_or_none(card.get("color_identity")),
        _json_or_none(card.get("finishes")),
        _json_or_none(card.get("legalities")),
        _json_or_none(card.get("image_uris")),
        prices.get("usd"),
        prices.get("usd_foil"),
        prices.get("usd_etched"),
        prices.get("eur"),
        prices.get("eur_foil"),
        prices.get("tix"),
        card.get("scryfall_uri"),
    )


def _face_rows(card: dict[str, Any]) -> list[tuple[Any, ...]]:
    faces = card.get("card_faces") or []
    return [
        (
            card["id"],
            index,
            face["name"],
            face.get("mana_cost"),
            face.get("type_line"),
            face.get("oracle_text"),
            _json_or_none(face.get("colors")),
            _json_or_none(face.get("image_uris")),
        )
        for index, face in enumerate(faces)
    ]


@contextmanager
def _open_stream(path: Path) -> Iterator[IO[bytes]]:
    """Open ``path`` for binary reading, transparently decompressing ``.gz``."""
    if path.suffix == ".gz":
        with gzip.open(path, "rb") as fh:
            # GzipFile is a binary stream at runtime but isn't typed as IO[bytes].
            yield cast("IO[bytes]", fh)
    else:
        with path.open("rb") as fh:
            yield fh


def _iter_cards(path: Path) -> Iterator[dict[str, Any]]:
    """Yield each card object from the bulk JSON array without loading it all.

    ``use_float=True`` makes ijson yield plain floats for JSON numbers (e.g.
    ``cmc``) instead of ``decimal.Decimal``, which sqlite3 cannot bind.
    """
    with _open_stream(path) as fh:
        yield from ijson.items(fh, "item", use_float=True)


def import_bulk_file(conn: sqlite3.Connection, path: Path) -> ImportResult:
    """Refresh the card catalog from the bulk file at ``path``.

    Upserts every card in the export, replaces each card's faces, and deletes
    printings absent from the export unless a row in another table still
    references them through a foreign key that does not cascade. Returns the
    number of cards and faces written plus the retired and kept counts. Raises
    :class:`FileNotFoundError` if ``path`` is missing and :class:`BulkImportError`
    if a card object is malformed; on any failure the transaction rolls back,
    leaving the prior catalog intact.
    """
    if not path.exists():
        raise FileNotFoundError(path)

    cards = faces = 0
    card_batch: list[tuple[Any, ...]] = []
    face_batch: list[tuple[Any, ...]] = []
    # Own the transaction with explicit SQL (BEGIN/COMMIT/ROLLBACK) rather than
    # relying on db.connect()'s isolation mode, so the refresh is atomic
    # regardless of how the connection is configured: a failure rolls back to
    # the prior catalog instead of leaving it half-updated.
    conn.execute("BEGIN")
    try:
        # bulk_seen collects every id in the export so the sweep can tell which
        # printings vanished. Its PRIMARY KEY also rejects a repeated id.
        conn.execute("CREATE TEMP TABLE IF NOT EXISTS bulk_seen (scryfall_id TEXT PRIMARY KEY)")
        conn.execute("DELETE FROM bulk_seen")
        try:
            for card in _iter_cards(path):
                if not isinstance(card, dict):
                    raise BulkImportError(
                        f"malformed bulk file: expected card objects, got {type(card).__name__}"
                    )
                try:
                    card_batch.append(_card_row(card))
                    new_faces = _face_rows(card)
                except (KeyError, TypeError) as exc:
                    raise BulkImportError(
                        f"malformed card object {card.get('id', '<unknown>')!r}: "
                        f"missing/invalid {exc}"
                    ) from exc
                face_batch.extend(new_faces)
                cards += 1
                faces += len(new_faces)
                if len(card_batch) >= _BATCH_SIZE:
                    _flush(conn, card_batch, face_batch)
                    card_batch.clear()
                    face_batch.clear()
                if cards % _PROGRESS_EVERY == 0:
                    logger.info("importing Scryfall bulk data: %d cards…", cards)
            _flush(conn, card_batch, face_batch)
            retired, kept = _sweep(conn)
            # Repopulate the name search index from the refreshed catalog; the
            # external-content FTS table (migration 0004) holds no copy of its
            # own, so upserts and deletes both need a rebuild (VEG-215, ADR 0008).
            rebuild_name_index(conn)
            # COMMIT inside the inner try so a constraint that only surfaces at
            # commit time is still wrapped as BulkImportError.
            conn.execute("COMMIT")
        except BulkImportError:
            raise
        except sqlite3.IntegrityError as exc:
            raise BulkImportError(f"constraint violation while loading bulk data: {exc}") from exc
        except (ijson.JSONError, OSError, EOFError, zlib.error) as exc:
            # zlib.error (corrupt deflate body) does not subclass OSError, so it
            # is listed explicitly alongside the gzip/parse failures.
            raise BulkImportError(
                f"could not parse bulk file {path}: {exc} — "
                "the download may be corrupt; re-fetch it"
            ) from exc
    except BaseException:
        # BaseException (not just Exception) so a KeyboardInterrupt mid-import
        # still rolls back this destructive operation before propagating.
        logger.error("Scryfall bulk import failed; rolling back", exc_info=True)
        conn.execute("ROLLBACK")
        # A temp table created inside the transaction rolls back with it, so
        # this is usually a no-op; IF EXISTS keeps it from raising.
        conn.execute("DROP TABLE IF EXISTS temp.bulk_seen")
        raise

    conn.execute("DROP TABLE IF EXISTS temp.bulk_seen")
    logger.info(
        "Scryfall bulk import complete: %d cards, %d faces, %d retired, %d kept",
        cards,
        faces,
        retired,
        kept,
    )
    return ImportResult(cards=cards, faces=faces, retired=retired, kept=kept)


def _flush(
    conn: sqlite3.Connection,
    card_rows: list[tuple[Any, ...]],
    face_rows: list[tuple[Any, ...]],
) -> None:
    """Write a batch — cards before faces, so the FK parent always exists.

    Every card in the batch loses its old faces first, including a card that
    now has none, so a face count that shrinks leaves no stale rows behind.
    """
    if card_rows:
        ids = [(row[0],) for row in card_rows]
        conn.executemany("INSERT INTO bulk_seen (scryfall_id) VALUES (?)", ids)
        conn.executemany(_UPSERT_CARD, card_rows)
        conn.executemany("DELETE FROM card_faces WHERE scryfall_id = ?", ids)
    if face_rows:
        conn.executemany(_INSERT_FACE, face_rows)


def _guarding_references(conn: sqlite3.Connection) -> list[tuple[str, str]]:
    """Return ``(table, column)`` for every foreign key into ``cards`` that does not cascade.

    RESTRICT and NO ACTION would block the sweep's delete, and SET NULL or SET
    DEFAULT would silently change user rows, so all of them guard a printing.
    Only CASCADE children (``card_faces``) belong to the printing. Discovered
    from the schema so a new referencing table can't reintroduce VEG-575.
    """
    rows = conn.execute(
        'SELECT m.name, p."from" FROM sqlite_master m '
        "JOIN pragma_foreign_key_list(m.name) p "
        "WHERE m.type = 'table' AND p.\"table\" = 'cards' COLLATE NOCASE "
        "AND p.on_delete <> 'CASCADE'"
    ).fetchall()
    return [(table, column) for table, column in rows]


def _sweep(conn: sqlite3.Connection) -> tuple[int, int]:
    """Delete printings absent from the export that nothing references.

    Returns ``(retired, kept)``. Kept printings left the export but are still
    referenced, for example owned or slotted; they stay with their last-known
    data so inventory and Tomes keep resolving.
    """
    # Table and column names come from the schema via _guarding_references, not
    # user input, so f-string interpolation is safe here.
    guards = "".join(
        f' AND scryfall_id NOT IN (SELECT "{col}" FROM "{table}")'
        for table, col in _guarding_references(conn)
    )
    vanished = "scryfall_id NOT IN (SELECT scryfall_id FROM bulk_seen)"
    total = int(conn.execute(f"SELECT COUNT(*) FROM cards WHERE {vanished}").fetchone()[0])
    # Delete faces explicitly so the sweep stays correct on a connection that
    # has foreign key enforcement (and so the CASCADE) turned off.
    conn.execute(
        f"DELETE FROM card_faces WHERE scryfall_id IN "
        f"(SELECT scryfall_id FROM cards WHERE {vanished}{guards})"
    )
    retired = conn.execute(f"DELETE FROM cards WHERE {vanished}{guards}").rowcount
    kept = total - retired
    if kept:
        logger.warning(
            "Scryfall bulk import kept %d printing(s) missing from the export "
            "because inventory or a Tome still references them",
            kept,
        )
    return retired, kept
