-- Converts every timestamp column from TIMESTAMP (no timezone) to TIMESTAMPTZ.
--
-- Why this matters: a naive "timestamp without time zone" column stores a bare
-- wall-clock value with no UTC/timezone information attached. node-postgres's
-- default type parser reads such a value back by constructing a JS Date using
-- the *Node process's own local timezone* (via `new Date(y, m, d, h, mi, s)`,
-- not `Date.UTC(...)`). If Postgres's session timezone and the Node process's
-- timezone don't match — a very plausible situation once this deploys to a
-- hosted DB whose timezone may differ from a developer's laptop — every
-- timestamp read back is silently shifted by the difference between the two.
-- That shift is invisible most of the time, but corrupts any day-boundary
-- logic (streaks, "today's" calendar activity, VisitLog dedup) whenever the
-- shift happens to cross midnight.
--
-- TIMESTAMPTZ stores an unambiguous instant (internally UTC) and is always
-- read back correctly regardless of either side's session/process timezone —
-- this is standard Postgres guidance: default to timestamptz unless you have
-- a specific reason not to.
--
-- USING clause: the existing naive values are assumed to already represent UTC
-- wall-clock time (true if, as in most default Postgres installs including this
-- project's dev setup, the session timezone was UTC when they were written).
-- If your local Postgres's session timezone was NOT UTC when this data was
-- written, existing rows will be off by that offset after this migration —
-- acceptable for early-stage dev data, but worth knowing before running this
-- against anything with real historical data you care about.

ALTER TABLE "User" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "HabitLog" ALTER COLUMN "logTimestamp" TYPE TIMESTAMPTZ USING "logTimestamp" AT TIME ZONE 'UTC';
ALTER TABLE "VisitLog" ALTER COLUMN "visitedAt" TYPE TIMESTAMPTZ USING "visitedAt" AT TIME ZONE 'UTC';
ALTER TABLE "Habit" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "Habit" ALTER COLUMN "archivedAt" TYPE TIMESTAMPTZ USING "archivedAt" AT TIME ZONE 'UTC';
ALTER TABLE "User" ALTER COLUMN "birthDate" TYPE TIMESTAMPTZ USING "birthDate" AT TIME ZONE 'UTC';
