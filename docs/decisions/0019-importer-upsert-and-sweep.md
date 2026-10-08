# 0019 — Importer Upsert and Guarded Sweep

**Status:** accepted (2026-10-08)

Resolves [VEG-575]. Replaces the "Full replace" bullet of
[0006](0006-bulk-import.md). The old importer ran `DELETE FROM cards` before
reloading. `inventory` ([0009](0009-inventory-schema.md)) and `deck_cards`
([0018](0018-deck-schema.md)) reference `cards` with `ON DELETE RESTRICT`, so
the nightly refresh failed with `FOREIGN KEY constraint failed` as soon as one
lot or one Tome slot existed.

[VEG-575]: https://linear.app/vega-apps/issue/VEG-575

---

## Decision

`import_bulk_file` keeps its single explicit transaction and its batching, and
changes how rows get written:

- **Upsert cards.** Each card is written with
  `INSERT ... ON CONFLICT(scryfall_id) DO UPDATE SET` over every non-key column.
  Existing rows update in place, so nothing that references them breaks.
- **Replace faces per card.** Each flush deletes the `card_faces` rows for
  every card in the batch, then inserts the new faces. A card whose face count
  shrinks, or whose new layout has no faces, keeps no stale rows. Faces have no
  inbound foreign keys, so delete and reinsert is safe.
- **Track the export in a temp table.** `bulk_seen` holds every id in the
  file. Its PRIMARY KEY keeps the old contract that a repeated id in one export
  raises `BulkImportError`. The importer drops it after COMMIT and after
  ROLLBACK.
- **Guarded sweep.** After the last batch, the importer deletes printings
  absent from `bulk_seen` unless a referencing row still points at them. It
  finds the referencing tables at runtime with one query over `sqlite_master`
  joined to `pragma_foreign_key_list`, keeping any reference to `cards` that
  does not cascade. RESTRICT and NO ACTION would block the delete, and SET
  NULL or SET DEFAULT would silently change user rows. The sweep deletes the
  swept printings' faces itself, so it stays correct on a connection with
  foreign key enforcement off.
- **Kept printings are logged.** A printing that left the export but is owned
  or slotted stays with its last-known data, so inventory and Tomes keep
  resolving. The importer logs the kept count at WARNING. `ImportResult` gains
  `retired` (deleted) and `kept` (left in place), both defaulting to 0.
- The name search index still rebuilds after the sweep, as in
  [0008](0008-card-name-search.md).

---

## Alternatives Considered

- **Keep full replace and turn foreign keys off during the import.** Rejected.
  It would leave lots and slots pointing at printings that no longer exist,
  which is the corruption RESTRICT exists to prevent.
- **Delete then reinsert only the referenced rows.** Rejected. SQLite checks
  RESTRICT per statement, so the delete fails before the reinsert can run.
- **Hard-code the referencing tables in the sweep.** Rejected in favor of
  PRAGMA discovery. The next table that references `cards` would otherwise
  bring this bug back unless someone remembered to edit the importer.

---

## Consequences

- The catalog no longer mirrors the export exactly. Printings Scryfall drops
  stay while a user holds them. Their prices and legalities freeze at the last
  export that included them.
- A new table that references `cards` gets sweep protection with any
  `ON DELETE` action except CASCADE, including no clause at all. A CASCADE
  reference is swept along with the printing it points at, by design.
- Cards keep their rowids across refreshes, which keeps the FTS rowid mapping
  stable between rebuilds.
- `refresh.py` still records only the card and face counts. Surfacing `kept`
  in the UI is out of scope here.
