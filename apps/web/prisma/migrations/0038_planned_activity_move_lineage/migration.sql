-- Daily Experience V1 PR D2: Move lineage.
--
-- A moved plan stays as history (status 'MOVED', a plain-text lifecycle value
-- -- no enum change) and its SUCCESSOR points backward at it:
-- successor."rescheduledFromPlanId" = moved."id". UNIQUE means one plan can
-- have at most one successor, so a fork (A -> B and A -> C) is impossible even
-- if application locking were bypassed. ON DELETE SET NULL keeps a successor
-- intact if its predecessor row is ever removed.
--
-- Additive only: one nullable column, its unique index and self-referencing
-- foreign key. No backfill (no historical row is ever inferred to be moved).

ALTER TABLE "PlannedActivity" ADD COLUMN "rescheduledFromPlanId" TEXT;

CREATE UNIQUE INDEX "PlannedActivity_rescheduledFromPlanId_key" ON "PlannedActivity"("rescheduledFromPlanId");

ALTER TABLE "PlannedActivity" ADD CONSTRAINT "PlannedActivity_rescheduledFromPlanId_fkey" FOREIGN KEY ("rescheduledFromPlanId") REFERENCES "PlannedActivity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
