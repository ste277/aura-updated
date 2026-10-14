-- Daily Rhythm V1 PR DR1 -- Preferences Foundation. Three additive
-- columns on "User" (see AURA_DAILY_RHYTHM_V1_ARCHITECTURE_AUDIT.md
-- section 4/8, Option A: one daily work window + a work-day set, not a
-- new table, not a per-weekday-varying schedule).
--
-- ADDITIVE ONLY, NO BACKFILL: every existing row gets
-- dailyRhythmWorkStart = NULL, dailyRhythmWorkEnd = NULL,
-- dailyRhythmWorkDays = '{}' -- identical behavior to today for every
-- existing user (same "no default written without explicit user
-- confirmation" precedent as availabilityConfigured, migration 0034).
--
-- dailyRhythmWorkStart/dailyRhythmWorkEnd are nullable "HH:mm" text,
-- same convention as UserAvailabilityPeriod.startTime/endTime -- BOTH
-- NULL is the only unconfigured state; the application layer
-- (setDailyRhythmPreferences, db.ts) always writes/clears them together,
-- never independently.
--
-- dailyRhythmWorkDays is a Postgres integer array (weekday 0=Sunday..
-- 6=Saturday, same convention as UserAvailabilityPeriod.weekday),
-- defaulting to an empty array -- an empty set is a valid, deliberate
-- "no work days configured" state, not an error.
--
-- NOT READ BY ANY SCHEDULING CODE YET: the day constructor, Find a Time,
-- Home, and Goals are all untouched by this migration and this PR --
-- these columns are pure persisted preference until a later,
-- separately-authorized PR wires them into recommendation logic.
ALTER TABLE "User"
  ADD COLUMN "dailyRhythmWorkStart" TEXT,
  ADD COLUMN "dailyRhythmWorkEnd" TEXT,
  ADD COLUMN "dailyRhythmWorkDays" INTEGER[] NOT NULL DEFAULT '{}';
