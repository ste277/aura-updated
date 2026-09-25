-- Remaining-Day Recomposition V1 PR F1: persisted scheduling mode.
--
-- A committed occurrence's scheduling CONSTRAINT, kept after planning so a
-- later feature can tell whether Aura may PROPOSE another time for it:
--   FIXED    -- the occurrence's time is a commitment; protected from Aura-driven recomposition.
--   FLEXIBLE -- Aura may propose (never silently apply) another time.
--   NULL     -- legacy / unknown; treated as PROTECTED (fail closed).
--
-- Additive only: one new enum type and one nullable column. There is
-- deliberately NO default and NO backfill -- no historical row has a
-- trustworthy scheduling mode, so every existing row stays NULL (unknown =
-- protected). Nothing is rewritten and nothing is inferred.

CREATE TYPE "PlannedActivitySchedulingMode" AS ENUM ('FIXED', 'FLEXIBLE');

ALTER TABLE "PlannedActivity" ADD COLUMN "schedulingMode" "PlannedActivitySchedulingMode";
