-- HPG3-A1 -- Daily Occurrence Data-Model Foundation. Four additive,
-- nullable columns, no new table, no backfill, no new constraint.
--
-- "GoalActivity".dailyFrequencyKind/dailyFrequencyLimit: "how many LIVE
-- occurrences of this GoalActivity may exist on the SAME local calendar
-- day?" -- orthogonal to the existing weekly cadence fields (migration
-- 0043), which answer a WEEKLY question with no day-bucket concept at
-- all; existing weekly cadence fields remain unchanged. Same convention
-- as that weekly pair and as
-- completionKind/completionTargetValue/completionUnit (migration 0040):
-- independently nullable, no default, no backfill. NULL means "never
-- specified" and is ALWAYS normalized to canonical ONCE_PER_DAY
-- (normalizeGoalActivityDailyFrequency, apps/web/lib/goalActivityDailyFrequency.ts)
-- -- every existing row keeps meaning exactly "at most one live occurrence
-- per local day" without any migration. dailyFrequencyLimit is only ever
-- meaningful when dailyFrequencyKind = 'CUSTOM' (reserved in this slice,
-- not yet an enforced policy); NULL for every other kind.
--
-- "GoalActivityOccurrence".scheduledLocalDate/scheduledLocalTimezone: the
-- SAME frozen-snapshot discipline as scheduledWeekStart/scheduledWeekTimezone
-- (migration 0047), for the DAY an occurrence is scheduled for rather than
-- the week -- a "YYYY-MM-DD" local calendar date frozen at write/Move
-- time, never re-derived live, plus the IANA zone used to compute it, kept
-- for audit/debugging context. Same additive-only, no-backfill precedent.
--
-- NOT READ OR WRITTEN BY ANY PRODUCTION PATH YET: Plan creation, Day
-- Constructor acceptance, Move, Recomposition, and weekly Rhythm
-- materialization are all untouched by this migration and this PR --
-- these columns are pure, inert schema until a later, separately-
-- authorized PR (HPG3-A2) wires reads and writes.
ALTER TABLE "GoalActivity"
  ADD COLUMN "dailyFrequencyKind" TEXT,
  ADD COLUMN "dailyFrequencyLimit" INTEGER;

ALTER TABLE "GoalActivityOccurrence"
  ADD COLUMN "scheduledLocalDate" TEXT,
  ADD COLUMN "scheduledLocalTimezone" TEXT;
