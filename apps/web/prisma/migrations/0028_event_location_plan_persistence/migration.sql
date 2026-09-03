-- Event Location Plan Persistence V1: an immutable snapshot of the Event
-- Location (PR "Add event-specific location to Muhurtham search") that
-- produced a saved plan's timing, so it can be redisplayed correctly and
-- independently of the owner's current Timing Location.
--
-- Both columns nullable, no default, no backfill: NULL on existing rows
-- correctly and permanently means "this plan used the Timing Location, not
-- a custom Event Location" -- backfilling from the owner's CURRENT Timing
-- Location would manufacture false historical information about what was
-- actually used to calculate a plan saved before this migration existed.
--
-- No latitude/longitude columns -- no workflow recomputes Panchang/
-- Muhurtham from a saved PlannedActivity (audited before this PR), so
-- coordinates would be unused persisted precision. Data minimization.
ALTER TABLE "PlannedActivity" ADD COLUMN "eventTimezone" TEXT;
ALTER TABLE "PlannedActivity" ADD COLUMN "eventLocationName" TEXT;
