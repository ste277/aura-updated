-- Birth Data Correctness B2 -- READ-ONLY operator diagnostic: aggregate counts only.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f deploy/diagnostics/birth-date-surrogate-check.sql
--
-- CONTEXT. `User.birthDate` and `SavedPerson.birthDate` are timestamptz columns that hold a UTC-MIDNIGHT SURROGATE for the civil birth date (1990-06-15 is stored as
-- 1990-06-15T00:00:00Z). Before B2 the writers handed PostgreSQL the bare string '1990-06-15', which the server resolves in its SESSION TimeZone: on a UTC server that
-- is UTC midnight (correct), on an east-of-UTC server it is local midnight = the previous UTC day (e.g. 1990-06-14T18:30Z, so every reader recovered the wrong civil date).
--
-- WHAT THIS REPORTS, per table: how many rows carry a birthDate, and how many of those have a UTC time-of-day other than 00:00:00.000.
-- The time-of-day is taken with AT TIME ZONE 'UTC', so the answer does not depend on this session's TimeZone.
--
-- HOW TO READ IT (carefully).
--   * A non-zero `non_midnight_utc_rows` is EVIDENCE that those rows were written while the database session TimeZone was not UTC, i.e. their stored value may be shifted
--     from the civil date the user entered. It is a lower bound on what needs review, not a repair list.
--   * A zero count does NOT prove every row is right. A row written under a UTC session is correct; but nothing in the data records which session timezone wrote a row, and
--     rows written before migration 0006 (timestamp without time zone) carry the same ambiguity. "Midnight" rows are NOT certified correct by this query.
--   * Do not repair rows from this output alone: correcting a shifted row requires knowing the writer's session timezone or re-confirming the civil date with the person.
--
-- PRIVACY. The output is two numbers per table. It selects no id, name, email, date, time, coordinate or city, and groups by nothing that identifies a person.
-- Read-only: a single SELECT, no write, no function with side effects.

SELECT
  'User'::text AS table_name,
  count(*) FILTER (WHERE "birthDate" IS NOT NULL) AS rows_with_birth_date,
  count(*) FILTER (WHERE "birthDate" IS NOT NULL AND ("birthDate" AT TIME ZONE 'UTC')::time <> TIME '00:00:00') AS non_midnight_utc_rows
FROM "User"
UNION ALL
SELECT
  'SavedPerson'::text,
  count(*) FILTER (WHERE "birthDate" IS NOT NULL),
  count(*) FILTER (WHERE "birthDate" IS NOT NULL AND ("birthDate" AT TIME ZONE 'UTC')::time <> TIME '00:00:00')
FROM "SavedPerson";
