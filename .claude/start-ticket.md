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
- Frontend: `cd frontend && npm test` (Vitest + React Testing Library, jsdom; see ADR 0010).
  Use `npm test -- <pattern>` for a subset, `npm run test:watch` while iterating.

## Test-coverage conventions
- Required (per CLAUDE.md): data-model logic, the scanner pipeline, Scryfall sync code.
- UI/glue code can lean lighter but must be manually exercised before committing.
- Prefer fast unit tests; **mock Scryfall — no network calls in tests**.
- For UI work, tests ship in the same PR, never deferred to a follow-up ticket.

## Verification gate (run before commit — no `verify.sh` yet; all must pass)
1. Backend tests: `cd backend && uv run pytest`
2. Backend lint/format: `cd backend && uv run ruff check && uv run ruff format --check`
3. Backend types: `cd backend && uv run mypy`
4. Frontend tests: `cd frontend && npm test`
5. Frontend build (catches type errors dev mode hides): `cd frontend && npm run build`
6. Frontend lint + format: `cd frontend && npm run lint && npm run format:check`

Most of the above also run automatically on commit via pre-commit (`.pre-commit-config.yaml`);
run all hooks manually with `pre-commit run --all-files`.

### E2E (Playwright — VEG-434, ADR 0015)
- Run as the **last** gate step: `cd frontend && npm run test:e2e` (Playwright, Chromium).
- Hermetic: boots only the Vite dev server and stubs `/api/**` in-browser (`e2e/stubs.ts`) —
  no backend, no Scryfall, no network. First run on a machine needs `npx playwright install chromium`.
- Specs live in `frontend/e2e/`; cover the app shell (brand/nav/status), the Inscribe golden
  path, and screenshot capability. Add/extend a spec for any new user-facing flow.
- If the dev server or browser can't start, state "E2E: could not run (reason)" rather than
  claiming success. Not yet wired into CI (no GitHub Actions in this repo).

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
