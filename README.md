# The Markov Scriptorium

A personal tool for storing, tracking, and managing a Magic: The Gathering card collection and the decks built from it.

Named for Edgar Markov, patriarch of the Innistrad vampires — a fitting patron for a meticulously curated hoard kept in candlelight.

## Status

In early development — Milestone 1 (project scaffolding).

## Structure

A hybrid Python + TypeScript monorepo (see [ADR 0001](docs/decisions/0001-foundational-architecture.md) and [ADR 0003](docs/decisions/0003-framework-and-tooling.md)):

| Path | What lives here |
|------|-----------------|
| `backend/` | Python API (FastAPI), the scanner pipeline, and Scryfall sync |
| `frontend/` | TypeScript web app (React + Vite) |
| `data/` | Local SQLite database and Scryfall bulk data (git-ignored) |
| `docs/` | Design doc (`PROJECT.md`) and architecture decision records |

## Development

### Run the whole stack

```bash
./dev.sh           # backend (:8000) + frontend (:5173) with hot reload; Ctrl-C stops both
./dev.sh --full    # same, but download the real Scryfall bulk data (about 80 MB) on startup
./stop.sh          # free the dev ports after a crash / orphaned run
```

By default `dev.sh` runs in **fast mode**: it skips the Scryfall download and seeds a
handful of cards (`backend/scripts/seed_dev.py`, idempotent) so the Inscribe flow works
immediately. Use `--full` when you want the complete catalog. The two servers can also be
run separately (below).

The card scanner at `/scan` needs a secure context for camera access.
`http://localhost:5173` counts as one, so the dev server works as is.

### Backend (Python + uv)

Requires [uv](https://docs.astral.sh/uv/). From `backend/`:

```bash
uv sync                                        # create the venv and install deps
uv run uvicorn scriptorium.main:app --reload   # dev server on http://127.0.0.1:8000
uv run pytest                                  # run the tests
uv run ruff format && uv run ruff check --fix  # format and lint
uv run mypy                                     # type-check (strict)
```

Leave `--reload` off when the server stays up for hours, because a crashed reload worker
leaves the port held with nothing answering.

#### Scanner

The Scry a Card page reads card titles with Apple's Vision framework, which ships with
macOS. On a Mac, Vision is used and `uv sync` is enough. On Linux and Windows the glass
reads with Tesseract when it is installed:

```bash
brew install tesseract          # macOS or Linux with Homebrew
sudo apt install tesseract-ocr  # Debian and Ubuntu
```

On Windows, install the UB Mannheim build and point `SCRIPTORIUM_TESSERACT` at
`tesseract.exe`. Without Tesseract the page says "No scrying glass is fitted", and typing
the name still works. `SCRIPTORIUM_OCR` takes `auto` by default, `vision` or `tesseract` to
force one engine and fail at startup when it cannot load, or `none` to turn scanning off.
See [ADR 0026](docs/decisions/0026-scanner-recognition-engine-and-name-match.md).

On a modern card the glass also reads the collector number and set code in the corner and
lands on the exact printing. Older cards and misreads go through the printing picker as
before. See [ADR 0027](docs/decisions/0027-scanner-corner-read-pins-the-printing.md). The
corner pin needs Vision, so on Tesseract every scan goes through the picker. See
[ADR 0028](docs/decisions/0028-tesseract-as-the-second-scanner-engine.md).

When the glass reads a name but lands on no printing, set `SCRIPTORIUM_LOG_LEVEL=DEBUG`
and scan again. The backend log then shows the title and corner reads, the corner as parsed,
and what the catalog held for each collector number tried. A corner read well that still
pins nothing is most often a List reprint or promo printed with the same corner, and the log
names it as a sibling. The variable defaults to `INFO`. `uvicorn --log-level` sets only
uvicorn's own loggers, never the scriptorium's.

### Frontend (React + Vite)

From `frontend/`:

```bash
npm install
npm run dev          # dev server with hot reload
npm run build        # type-check (strict) and production build
npm run format       # format with Prettier
npm run lint         # lint with ESLint
```

### Database migrations

The catalog schema is managed with plain versioned SQL files in `backend/migrations/`
(`NNNN_description.sql`). On app startup, every migration newer than the database's recorded
version is applied automatically (see [ADR 0004](docs/decisions/0004-schema-migrations.md)).

To make a schema change, add the next-numbered file — plain DDL, no `BEGIN`/`COMMIT`:

```
backend/migrations/0002_add_card_table.sql
```

It applies on the next startup. Migrations are forward-only — never edit a shipped migration; add a new one.

### Backups and restore

A backup is a copy of the SQLite catalog that holds the schema, every lot and Tome, and only the
card rows those reference. Each copy is kilobytes to a few megabytes. Copies land in a `backups/`
folder beside the database file, so `data/backups/` by default, or next to the file named by
`SCRIPTORIUM_DB_PATH`.

The app seals copies on its own in two cases:

- **Before migrations.** When migrations are pending and the catalog already holds a lot or a
  Tome, the app seals a copy first. If that fails, startup aborts and the app refuses to migrate
  unprotected.
- **Once a day.** A background task seals a daily copy when the catalog holds a lot or a Tome and
  none is under 23 hours old. It runs right after startup, before the Scryfall refresh, in the
  same background thread, and checks again every hour while the app runs. A server left up for
  days still gets one copy a day. Startup never waits for it, and a failure is logged.

To take a copy by hand, open the Archive page and press "Seal a copy", or run:

```
curl -X POST http://127.0.0.1:8000/archive/backups
```

If a Scryfall refresh is writing to the catalog, the request returns 409. Seal a copy once the
refresh completes.

Files are named `scriptorium-20261015T142233Z-v6-manual.db`. That is a UTC timestamp, the schema
version, and the reason (`manual`, `premigration` or `daily`, which the Archive page labels
"Daily"). The app keeps the newest 10 manual copies, 3 premigration copies and 7 daily copies,
and deletes older ones that match that name pattern after each backup. Set
`SCRIPTORIUM_BACKUP_KEEP` to change the manual count.

Each backup first writes a full-size temp copy and then shrinks it. Sealing a copy needs free
disk roughly equal to the catalog file, about a gigabyte with the real Scryfall export, plus
scratch space for `VACUUM`, even though the finished copy is small.

The Archive page also offers two exports, sent as downloads to your own disk:

- **CSV** (`/archive/export.csv`) has one row per lot in the Manabox column layout, plus
  Location, Notes, Tags, Acquired at and Price paid. It reads back through the CSV import page.
  The import drops those last five columns until VEG-614 lands.
- **JSON** (`/archive/export.json`) is the full record. It holds every lot and every Tome with its
  slots, with card names and set codes beside each Scryfall ID. You can read it without Scryfall
  or this app.

Restore is manual, because it overwrites the live catalog (VEG-613 proposes a guarded command).
Run these steps from the repo root, replacing `<file>` with the backup you chose:

```sh
# 1. Stop the backend with ./stop.sh, or Ctrl-C in its terminal.
# 2. Optionally check the copy. It should print "ok".
sqlite3 data/backups/<file> "PRAGMA quick_check"
# 3. Move the live file aside.
mv data/scriptorium.db data/scriptorium.db.bak
# 4. Keep any journal with the file it belongs to.
[ -f data/scriptorium.db-journal ] && mv data/scriptorium.db-journal data/scriptorium.db.bak-journal
# 5. Copy the backup into place.
cp data/backups/<file> data/scriptorium.db
# 6. Start the app again.
./dev.sh
```

An older backup is migrated forward on startup.

The first start after a restore downloads the Scryfall catalog again when auto-refresh is on,
because a copy does not carry it. Until that finishes, Inscribe autocomplete and the unowned part
of the Index are empty. Your owned cards, lots and Tomes are whole throughout. If
`SCRIPTORIUM_AUTO_REFRESH=0`, start the download yourself or turn auto-refresh back on:

```
curl -X POST http://127.0.0.1:8000/scryfall/refresh
```

In fast dev mode, run `uv run python scripts/seed_dev.py` from `backend/` to bring the dev cards
back instead.

### Code quality (pre-commit)

Lint, format, and type checks run automatically on commit via [pre-commit](https://pre-commit.com/). Enable the git hook once per clone:

```bash
uv tool install pre-commit   # if not already installed
pre-commit install
```

Run all checks manually with `pre-commit run --all-files`.

## Documentation

- [`docs/PROJECT.md`](docs/PROJECT.md) — design doc, data model, feature scope, naming history
- [`docs/decisions/`](docs/decisions/) — architecture decision records
- [`CLAUDE.md`](CLAUDE.md) — instructions for Claude Code contributors

## License

See [`LICENSE`](LICENSE).
