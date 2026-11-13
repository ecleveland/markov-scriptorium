# 0032 Refresh failure record and single flight

**Status:** accepted (2026-11-12)

Resolves [VEG-392]. Amends [ADR 0007](0007-auto-refresh.md), which deferred
both items to keep VEG-214 in scope.

[VEG-392]: https://linear.app/cleveland-family-enterprises/issue/VEG-392

---

## Context

ADR 0007 runs the Scryfall refresh in two places. The startup upkeep runs the
staleness-gated refresh on a worker thread, and `POST /scryfall/refresh`
schedules a forced one as a background task. Both wrappers logged a failure
and swallowed it. The `scryfall_refresh` row records only what succeeded, so a
refresh that crashed every hour looked like a healthy idle catalog until
`stale` turned true at 24 hours.

The two paths also ran without any coordination. Each opens its own
connection and holds a long write transaction through the import. A second
refresh started during the first waited out the busy timeout, failed with
"database is locked", and was logged after the user had already been told 202.
A status read during an import could also fail the same way and answer 500.

## Decision

**Record the last attempt.** Migration `0007` adds two nullable columns to
`scryfall_refresh`:

- `last_attempt_at`, the ISO-8601 UTC time the most recent attempt started.
- `last_error`, a short `ExceptionType: message` string, or NULL when the most
  recent attempt succeeded.

A success and a failure are recorded in different places. A successful check
or import stamps `last_attempt_at` and clears `last_error` in the same write
that records the check or the import. A separate write could fail on its own
and leave a new `last_checked_at` beside an old error. A failure is recorded by
the wrappers in `main.py` through `refresh.record_attempt`, never by
`refresh_catalog`, which keeps ADR 0007's rule that the refresh writes nothing
when it fails. The failure write uses a new connection, because the refresh's
own connection may be the one that failed. If that write fails too, the
wrapper logs it and carries on. A startup check that finds the catalog fresh
made no request, so it records nothing.

`GET /scryfall/status` keeps every field it had and adds `last_attempt_at`,
`last_error` and `refreshing`.

**One refresh at a time.** A process-wide `threading.Lock` in `main.py` guards
both wrappers. Each takes it without waiting and skips with an INFO log line
when another refresh holds it. Skipping beats waiting, because the refresh
already running fetches the same Scryfall export the second one would.

The startup path reads the staleness gate before it takes the lock. A fresh
catalog never holds the lock, so a manual refresh in that moment is not turned
away while startup decides to do nothing. When the catalog is stale, startup
takes the lock and `maybe_refresh` checks again under it. A
thread lock fits because both paths run on worker threads, one through
`asyncio.to_thread` and one through Starlette's threadpool.

`POST /scryfall/refresh` still answers 202 every time. Its body keeps
`message` and adds `already_running`. When a refresh holds the lock, the
endpoint schedules nothing and says so. A refresh that starts between that
check and the scheduled task is harmless, because the task's own try-acquire
skips.

**Status during an import answers 409.** In SQLite's rollback journal, an
import that spills its page cache holds the exclusive lock until it commits,
and readers wait. When the status read runs out of busy timeout, the endpoint
returns 409 with a themed detail instead of a 500. This is the same contract
the archive endpoints already use for a read blocked by the refresh.

**An explicit busy timeout.** `db.connect()` now passes
`timeout=BUSY_TIMEOUT_MS / 1000` to `sqlite3.connect`, with the constant at
5000 ms. Python already waits five seconds by default, so behavior does not
change, and a separate `PRAGMA busy_timeout` would only repeat it. The point is that the wait is now written down and tested in one
place. The archive code's comments already depend on it.

## Alternatives considered

- **Await instead of skip.** A second caller could block until the first
  refresh ends. That ties up a threadpool worker for minutes to repeat work
  that just finished, so it was rejected.
- **Acquire in the request, release in the task.** That would make the 202
  body exact, but a scheduled task that never runs would leave the lock held
  for the life of the process.
- **WAL mode.** WAL would let readers through during an import, which removes
  the 409 case. It changes the files on disk and how backups copy the catalog,
  so it was left for a later decision with its own ADR.
- **A longer busy timeout.** An import holds its lock for minutes, so no
  reasonable timeout would cover it, and a longer wait only delays the error a
  request sees.

## Consequences

- The catalog schema moves to version 7. Backups and exports report 7.
- A refresh that keeps failing now shows its error in `/scryfall/status`
  right away. No frontend reads that endpoint yet.
- The lock is per process. Running two backend processes against one catalog
  file would bring the collision back. The app runs one process.
