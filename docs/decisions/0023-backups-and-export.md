# 0023 Backups and export

**Status:** accepted (2026-10-15)

Resolves [VEG-281]. Decides how the catalog is copied, when the app does it on
its own, what the two exports contain, and how a restore works. Builds on
[0004](0004-schema-migrations.md), whose startup migration step is now the
trigger for an automatic backup, and on [0013](0013-csv-import-onboarding.md), whose
Manabox layout the CSV export writes back out.

[VEG-281]: https://linear.app/cleveland-family-enterprises/issue/VEG-281

---

## Decision

**A backup is a whole-file copy made in steps.** The backend uses the stdlib
`sqlite3.Connection.backup` with 1024 pages (4 MB) per step. Each step takes
SQLite's shared lock and releases it, so a Scryfall refresh running at the same
time never waits past its 5 second busy timeout. SQLite restarts the copy if
another connection commits mid-way. A plain file copy can tear a page and
misses the rollback journal.

**The copy goes to a temp file, gets checked, then is renamed.** The backend
creates a hidden `.scriptorium-<name>.<random>.tmp` file with
`tempfile.mkstemp`, so each attempt gets its own name. It runs
`PRAGMA quick_check` on the copy and moves it into place with `os.replace`. A failed check deletes the temp
file and the backup fails. That failure also tells the user the live file is
corrupt, which is worth knowing before the next migration. Pruning sweeps temp
files older than an hour, so an interrupted copy does not leak a gigabyte.

**A probe decides whether to start, and a refresh gets a 409.** Before copying,
the backend runs `BEGIN IMMEDIATE` with a one-second timeout and releases it
at once. The importer holds that lock for most of a real refresh, so when the
probe fails `POST /archive/backups` returns 409 with "The scribes are still
transcribing the catalog. Seal a copy once the refresh completes." A writer
that starts after the probe makes the copy give up after about five seconds of
locked steps, which is also a 409. No lock object couples the backup to the
refresh.

**Backups live in a `backups/` folder beside the database file.** That is
`data/backups/` by default, or next to `SCRIPTORIUM_DB_PATH`. A file is named
`scriptorium-20261015T142233Z-v6-manual.db`, which is a UTC stamp, the schema
version and the reason. The reasons are `manual` and `premigration`.

**Retention runs in two pools.** `SCRIPTORIUM_BACKUP_KEEP` sets how many manual
copies stay, default 3. The newest 2 premigration copies stay. Pruning runs
after each backup and deletes only files that match the backup filename
pattern, so a stray file in the folder is safe. A prune that cannot delete an
old file logs a warning, and the backup still succeeds. With the real Scryfall catalog
loaded a copy is about a gigabyte. In fast dev mode it is about 100 KB.

**Startup takes a premigration backup, and a failure stops startup.** The
backup runs before migrations, only when migrations are pending and the
catalog holds at least one lot or Tome. An empty catalog has nothing to lose.
The backup is also skipped when a copy of the current schema version is
already on disk and is either newer than the catalog file or less than an hour
old. That keeps a restart loop on a failing migration from taking a fresh copy
every time, while a stale copy from weeks ago does not suppress a new one.
If the backup fails, the app does not migrate. There is no time-based
automatic backup yet, see [VEG-612].

**The CSV export is the Manabox layout plus five columns.** One row per lot,
inventory only. The first ten columns are `Name, Set code, Set name, Collector
number, Foil, Rarity, Quantity, Scryfall ID, Condition, Language`, followed by
`Location, Notes, Tags, Acquired at, Price paid`. Finish values are
`normal|foil|etched`. Condition values are `near_mint, lightly_played,
moderately_played, heavily_played, damaged`. Tags join with `;`. The file reads
back through the CSV import page as a Manabox file ([VEG-415]).

**The JSON export is the full record.** The shape is:

```
{ format: "markov-scriptorium-export", format_version: 1,
  exported_at, schema_version, inventory: [...], tomes: [...] }
```

Each inventory entry has every lot column plus the card's name, set code, set
name and collector number. Each Tome carries its slots, each with scryfall_id, name,
set code, collector number, finish, board and quantity. A person can read it
without Scryfall or this app.

**Exports download to the browser.** `GET /archive/export.csv` and
`GET /archive/export.json` send attachments, so the browser writes them to the
user's own disk. Nothing is uploaded anywhere. An export requested while a
refresh holds the catalog returns the same 409 as a backup.

**Restore stays manual.** There is no endpoint, because overwriting the live
catalog is a destructive operation. The README lists the steps. [VEG-613]
proposes a guarded command.

**The Archive page is the maintenance home.** Route `/archive`, nav entry
"Archive", title "The Muniment Room", eyebrow "Safekeeping". It has a "Seal a
copy" button, a table of sealed copies, and the two export links.
`GET /archive/backups` returns `{directory, keep, premigration_keep, backups}`,
and the page reads both pool sizes from it. The code
lives in `scriptorium/archive.py`, with the router in `scriptorium/api/archive.py`
under the `/archive` prefix.

## Alternatives

- **A ledger backup** holding only inventory, decks, deck_cards and the card
  rows they reference, built by copying DDL from `sqlite_master` and rebuilding
  the FTS table. Copies would be kilobytes, but it is about 300 lines of SQL
  that run for real only at disaster time. A restored ledger also leaves Inscribe
  autocomplete and the unowned catalog empty until a refresh succeeds. The cheap
  form of the idea, shrinking a finished whole-file copy, is [VEG-612].
- **A single-step copy** with `pages=-1`. It holds the shared lock for the whole
  gigabyte and can push the importer's commit past its timeout.
- **A `threading.Lock` shared with the refresh.** It protects only in-process
  callers and makes a manual backup wait for an entire refresh.
- **A 202 response with a background copy and polling**, as `/scryfall/refresh`
  does ([0007](0007-auto-refresh.md)). The copy takes seconds, and a
  synchronous 201 is simpler.
- **Exports written to a server-side folder.** A browser download already lands
  on local disk and leaves nothing to manage.
- **Controls in the Catalog page header** instead of a page. There was no room
  for a list of backups, and the page now has a place to grow.

## Consequences

- Each copy costs a full catalog of disk, about a gigabyte with real data, and
  up to 5 copies stay. [VEG-612] covers shrinking a finished copy and adds
  automatic daily backups.
- The CSV carries five columns the import ignores until [VEG-614] lands. A
  round trip through the CSV import page loses Location, Notes, Tags, Acquired at
  and Price paid. The JSON export loses nothing.
- Restore is a hand procedure until [VEG-613]. A wrong step can overwrite the
  live file, which is why the README has the user move it aside first.
- [VEG-366] will move the data directory. The `backups/` folder is derived from
  the database path, so it follows with no change here.
- Startup can now fail for a new reason, the premigration backup. The log names
  the failed step, and the live database is untouched. A "scribes are still
  transcribing" 409 on a manual backup is not a failure, only a request to wait.
- The E2E stubs now carry `GET /archive/backups` and `POST /archive/backups`.
  A spec that exercises the exports must stub those routes too.

[VEG-366]: https://linear.app/cleveland-family-enterprises/issue/VEG-366
[VEG-415]: https://linear.app/cleveland-family-enterprises/issue/VEG-415
[VEG-612]: https://linear.app/cleveland-family-enterprises/issue/VEG-612
[VEG-613]: https://linear.app/cleveland-family-enterprises/issue/VEG-613
[VEG-614]: https://linear.app/cleveland-family-enterprises/issue/VEG-614
