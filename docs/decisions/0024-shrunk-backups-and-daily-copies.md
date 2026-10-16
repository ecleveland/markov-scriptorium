# 0024 Shrunk backups and daily copies

**Status:** accepted (2026-10-16)

Resolves [VEG-612]. Amends [0023](0023-backups-and-export.md), which decided
that a backup is a whole-file copy and left the shrink and the timed backup for
later. This record shrinks each copy to the printings the user owns and adds a
daily copy.

[VEG-575]: https://linear.app/cleveland-family-enterprises/issue/VEG-575
[VEG-612]: https://linear.app/cleveland-family-enterprises/issue/VEG-612

---

## Decision

**The backend shrinks the temp copy in place.** The stepped whole-file copy from
0023 stays. After it and before the checks, the backend opens the temp copy with
the real schema and reads the foreign keys from it. Every table other than
`card_faces` with a foreign key into `cards` keeps the printings it points at,
whatever its on-delete action. Today those are `inventory` and `deck_cards`.
The shrink deletes every `card_faces` and `cards` row that none of them
references. That is the same protection the importer's sweep uses
([0019](0019-importer-upsert-and-sweep.md), [VEG-575]). A table missing from an
older schema is skipped. It then empties `scryfall_refresh`, empties the
`cards_fts` index with `delete-all`, commits, and runs `VACUUM`. Last it rebuilds
`cards_fts` with the same rebuild the importer uses, over the final rowids, and
commits. `VACUUM` may renumber the implicit rowids of `cards`, so the index must
be built after it, and emptying the index first means `VACUUM` leaves no dead
index pages behind. The copy keeps its
`user_version`, every user table in full and every table's schema, so migrations
and reads work on a restored copy.

**Two read-only checks gate the file.** `PRAGMA quick_check` and
`PRAGMA foreign_key_check` both run on the shrunk copy. If either fails, the
backup fails and leaves no file. The foreign key check catches a shrink that
removed a card something still points at. It fails the backup only for
violations that were not already in the catalog before the shrink, so an
orphan row that predates the backup never blocks a backup or a migration.

**A restore downloads the catalog again.** Because `scryfall_refresh` is empty,
the first startup after a restore treats the catalog as never refreshed and
downloads the full Scryfall export. The importer's sweep keeps the owned
printings ([0019](0019-importer-upsert-and-sweep.md)). Until that refresh
finishes, Inscribe autocomplete and the unowned part of the Index are empty.
Owned cards, lots and Tomes are whole throughout. In fast dev mode
(`SCRIPTORIUM_AUTO_REFRESH=0`), `backend/scripts/seed_dev.py` repopulates the
dev cards. With `SCRIPTORIUM_AUTO_REFRESH=0` the download does not start by
itself, so the user triggers it with `POST /scryfall/refresh` or turns
auto-refresh back on.

**A third reason, `daily`, makes a timed copy.** A background task seals it when
the catalog holds a lot or a Tome and no daily copy is recent. A copy counts as recent for 23 hours, not 24, because
the hourly check would otherwise drift a copy later each day until a calendar
day passed without one. A copy whose file time is in the future, after the clock
moved back, does not count as recent. It
runs first right after startup, before the Scryfall refresh and in the same
background thread, so it never races the importer. It then checks again every
hour while the app runs, so a server left up for days still gets one copy a day.
Startup never waits for it. A failed daily copy is logged. The premigration copy
aborts startup because a destructive step follows it. Nothing destructive
follows a daily copy.

**Retention defaults rise.** Manual copies keep 10, and
`SCRIPTORIUM_BACKUP_KEEP` still overrides that. Premigration copies keep 3 and
daily copies keep 7. The three pools prune separately.
`GET /archive/backups` returns `keep`, `premigration_keep` and `daily_keep`.
The Archive page shows all three and labels daily copies "Daily".

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
- A new table that references `cards` needs no change to the shrink, because
  the shrink finds it in the schema.
- Each backup still writes a full-size temp copy before it shrinks it. Sealing
  a copy needs free disk roughly equal to the catalog file, about a gigabyte
  with the real export, for the duration of the copy, plus `VACUUM` scratch
  space, even though the finished copy is small.
- The 7 daily copies cover about a week of days that the app ran.
- [VEG-613] still proposes the guarded restore command, and [VEG-614] still
  covers the import columns.

[VEG-613]: https://linear.app/cleveland-family-enterprises/issue/VEG-613
[VEG-614]: https://linear.app/cleveland-family-enterprises/issue/VEG-614
