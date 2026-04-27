# Architecture Decision Records

Short notes recording significant decisions made during the project. Keep them light: what was decided, what was considered, why this choice won.

## Convention

**Filename:** `NNNN-short-title.md` — e.g. `0001-use-sqlite-for-local-storage.md`. Numbers are sequential and never reused, even if a decision is later superseded.

**Format:** free-form prose, but at minimum cover:

- **Decision** — what we're doing
- **Alternatives** — what else was on the table
- **Reasoning** — why this won
- **Status** — proposed / accepted / superseded by NNNN

## When to write one

Whenever a non-trivial choice gets made that future-you (or Claude Code) would benefit from understanding. Database choice, framework choice, schema design philosophy, the reserved-vs-referenced inventory question, scanner approach, etc.

When in doubt, write it down. ADRs are cheap; recovering lost context is expensive.
