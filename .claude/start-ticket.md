# start-ticket overrides — The Markov Scriptorium

Project-specific values for the `/start-ticket` workflow. This is a hybrid
monorepo: `backend/` (Python, managed with **uv**) and `frontend/`
(React + Vite, npm).

## Pre-flight
- Working tree clean (`git status`); surface uncommitted changes, never stash silently.
- No stale dev servers: backend uvicorn on `:8000`, frontend Vite on `:5173`.
- `gh auth status` must succeed.

## Fast test runners (inner TDD loop)
- Backend: `cd backend && uv run pytest -q` (use `-k <pattern>` for a single test).
- Frontend: `cd frontend && npm test` — **no runner configured yet**; add one with the
  first frontend logic ticket (Vitest is the natural fit for Vite).

## Test-coverage conventions
- Required (per CLAUDE.md): data-model logic, the scanner pipeline, Scryfall sync code.
- UI/glue code can lean lighter but must be manually exercised before committing.
- Prefer fast unit tests; **mock Scryfall — no network calls in tests**.
- For UI work, tests ship in the same PR, never deferred to a follow-up ticket.

## Verification gate (run before commit — no `verify.sh` yet; all must pass)
1. Backend tests: `cd backend && uv run pytest`
2. Backend lint/format: `cd backend && uv run ruff check . && uv run ruff format --check .`
   *(once ruff is wired up — VEG-210)*
3. Backend types: `cd backend && uv run mypy src` *(once mypy is wired up — VEG-210)*
4. Frontend build (catches type errors dev mode hides): `cd frontend && npm run build`
5. Frontend lint: `cd frontend && npm run lint`

No E2E suite exists yet — state "E2E: none configured" when reporting the gate.

## Commit / PR conventions
- Imperative mood, present tense ("Add scanner endpoint"). Body explains *why* if non-obvious.
- Reference the Linear ticket ID; put `Fixes VEG-XXX` in the PR body so Linear auto-links and
  transitions the issue.
- Stage only files relevant to the change; never `git add -A`; respect `.gitignore`.
- Record real design decisions (schema, framework, library) as ADRs in `docs/decisions/`.

## Review-sizing policy
- **skip** — docs/config/comment-only, or ≲30 changed lines / ≤3 files, no risk triggers.
- **standard** — everything else → `code-review medium --comment`.
- **deep** — risk triggers, full features (new endpoint / data model / schema), or
  ≳400 changed lines / ≳10 files → `/pr-review-toolkit:review-pr` then `code-review high --comment`.
- **Risk triggers for this project:** schema or migrations, the card↔deck reservation logic,
  Scryfall sync / bulk import, the scanner pipeline, and anything that writes to the local
  SQLite catalog.
