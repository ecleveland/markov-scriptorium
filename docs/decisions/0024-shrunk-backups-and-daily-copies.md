# 0024 Shrunk backups and daily copies

**Status:** accepted (2026-10-16)

Resolves [VEG-612]. Amends [0023](0023-backups-and-export.md), which decided
that a backup is a whole-file copy and left the shrink and the timed backup for
later. This record shrinks each copy to the printings the user owns and adds a
daily copy at startup.

[VEG-612]: https://linear.app/cleveland-family-enterprises/issue/VEG-612

---

## Decision

**The backend shrinks the temp copy in place.** The stepped whole-file copy from
0023 stays. After it and before the checks, the backend opens the temp copy with
the real schema and deletes every `card_faces` and `cards` row that no
`inventory` or `deck_cards` row references. A table missing from an older schema
is skipped. It then rebuilds `cards_fts` with the same rebuild the importer
uses, empties `scryfall_refresh`, commits, and runs `VACUUM`. The copy keeps its
`user_version`, every user table in full and every table's schema, so migrations
and reads work on a restored copy.

**Two read-only checks gate the file.** `PRAGMA quick_check` and
`PRAGMA foreign_key_check` both run on the shrunk copy. If either fails, the
backup fails and leaves no file. The foreign key check catches a shrink that
removed a card something still points at.

**A restore downloads the catalog again.** Because `scryfall_refresh` is empty,
the first startup after a restore treats the catalog as never refreshed and
downloads the full Scryfall export. The importer's sweep keeps the owned
printings ([0019](0019-importer-upsert-and-sweep.md)). Until that refresh
finishes, Inscribe autocomplete and the unowned part of the Index are empty.
Owned cards, lots and Tomes are whole throughout. In fast dev mode
(`SCRIPTORIUM_AUTO_REFRESH=0`), `backend/scripts/seed_dev.py` repopulates the
dev cards.

**A third reason, `startup`, makes a daily copy.** The app seals it after
migrations and before the refresh task, when the catalog holds a lot or a Tome
and no startup copy is under 24 hours old. A failed daily copy is logged and
startup continues. The premigration copy aborts startup because a destructive
step follows it. Nothing destructive follows a daily copy.

**Retention defaults rise.** Manual copies keep 10, and
`SCRIPTORIUM_BACKUP_KEEP` still overrides that. Premigration copies keep 3 and
startup copies keep 7. The three pools prune separately.
`GET /archive/backups` returns `keep`, `premigration_keep` and `startup_keep`.
The Archive page shows all three and labels startup copies "Daily".

**One `Literal` type holds the reasons.** The filename pattern, the listing and
the pools all derive from it, so adding a reason in one place cannot leave
another place behind.

## Alternatives

- **Full copies behind a flag.** Nobody asked for it, and the README restore
  steps already cover the one refresh a shrunk copy needs.
- **The ledger writer that copies DDL.** 0023 already rejected it. Shrinking a
  finished copy keeps the real schema without 300 lines of SQL that run for
  real only at disaster time.
- **Filtering during the copy.** The page-level backup API copies whole pages
  and cannot skip rows.

## Consequences

- 0023's size figures are superseded. A copy is kilobytes to a few megabytes
  instead of about a gigabyte, and the 100 KB dev figure no longer applies.
- `VACUUM` needs scratch space up to the unshrunk size for a moment.
- A restore needs network once, to download the catalog.
- Dev fast mode after a restore holds only owned cards until the seed script or
  a refresh runs.
- A backup takes a little longer. The deletes, the FTS rebuild and the `VACUUM`
  on a gigabyte temp file take a few seconds to a minute on a slow disk.
- Startup can seal a copy on every day the app starts, so the 7 daily copies
  cover about a week of days that the app ran.
- [VEG-613] still proposes the guarded restore command, and [VEG-614] still
  covers the import columns.

[VEG-613]: https://linear.app/cleveland-family-enterprises/issue/VEG-613
[VEG-614]: https://linear.app/cleveland-family-enterprises/issue/VEG-614
