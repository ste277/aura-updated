-- Goals V2 G2.1: the canonical completion-requirement domain model
-- (architecture audit + this implementation ticket, both against merged
-- Lunar Intelligence V1 HEAD 794c84e09a793bbc3aa5df401c94fcc3c14c3a58).
--
-- Establishes only the DEFINITION of "what counts as completing one
-- occurrence of this GoalActivity?" -- DONE / DURATION / MEASURED_TARGET
-- (apps/web/lib/goalCompletion.ts). Does NOT implement occurrence
-- progress, completion inference, checklists, or recurrence -- all
-- explicitly deferred to later slices per the G1 audit.
--
-- Three independent nullable columns on "GoalActivity", no DEFAULT, no
-- backfill -- same convention as migration 0039's
-- "PlannedActivity"."schedulingMode" (NULL = legacy/unknown, never
-- forced). "completionKind" = NULL means "never specified" and is
-- ALWAYS normalized to canonical DONE at read time
-- (normalizeGoalActivityCompletionRequirement) -- deliberately identical
-- treatment for a genuinely legacy pre-G2.1 row and a brand-new row
-- created without an explicit requirement, since the two behave
-- identically and this is the only way every existing GoalActivity keeps
-- meaning exactly "tap Done and the occurrence is complete" without a
-- data migration.
--
-- "completionTargetValue" is DOUBLE PRECISION (not INTEGER) -- same
-- convention as "User"."latitude"/"longitude" -- so a fractional target
-- (e.g. 2.5 km) is representable exactly.
--
-- Additive only: no existing column touched, no row rewritten, no
-- constraint added to any existing column, no data migrated. No change
-- to "Goal", "PlannedActivity", "Habit", or "HabitLog".

ALTER TABLE "GoalActivity"
  ADD COLUMN "completionKind" TEXT,
  ADD COLUMN "completionTargetValue" DOUBLE PRECISION,
  ADD COLUMN "completionUnit" TEXT;
