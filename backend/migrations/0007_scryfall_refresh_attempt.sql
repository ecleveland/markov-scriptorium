-- 0007_scryfall_refresh_attempt: the last refresh attempt and its error (VEG-392, ADR 0032).
--
-- 0003 records only what succeeded, so a refresh that fails every time looks
-- the same as one that never ran. These two columns record the most recent
-- attempt, whether it worked or not, so /scryfall/status can show the failure.
--
-- last_attempt_at is when the attempt started. last_error is a short
-- "ExceptionType: message" string, cleared to NULL by the next attempt that
-- succeeds. A startup check that finds the catalog fresh is no attempt and
-- writes neither column. Both are ISO-8601 UTC or NULL, like the rest of the row.

ALTER TABLE scryfall_refresh ADD COLUMN last_attempt_at TEXT;
ALTER TABLE scryfall_refresh ADD COLUMN last_error TEXT;
