-- 0007_scryfall_refresh_attempt: the last refresh attempt and its error (VEG-392, ADR 0032).
--
-- 0003 records only what succeeded, so a refresh that fails every time looks
-- the same as one that never ran. These two columns record the most recent
-- attempt, whether it worked or not, so /scryfall/status can show the failure.
--
-- last_attempt_at is when the attempt started, ISO-8601 UTC or NULL like the
-- row's other timestamps. last_error is free text or NULL: "ExceptionType:
-- message", or the type alone when there is no message, capped at 500
-- characters. The next attempt that succeeds clears it to NULL. A startup
-- check that finds the catalog fresh is no attempt and writes neither column.

ALTER TABLE scryfall_refresh ADD COLUMN last_attempt_at TEXT;
ALTER TABLE scryfall_refresh ADD COLUMN last_error TEXT;
