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

### Backend (Python + uv)

Requires [uv](https://docs.astral.sh/uv/). From `backend/`:

```bash
uv sync                                        # create the venv and install deps
uv run uvicorn scriptorium.main:app --reload   # dev server on http://127.0.0.1:8000
uv run pytest                                  # run the tests
uv run ruff format && uv run ruff check --fix  # format and lint
uv run mypy                                     # type-check (strict)
```

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
