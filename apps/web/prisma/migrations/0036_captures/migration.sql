-- Quick Capture V1 PR A: the persisted Capture domain ("I want to do this,
-- but I have not committed to when").
--
-- Persists ONLY OPEN / DISMISSED. PLANNED / COMPLETED are derived
-- (apps/web/lib/captures.ts deriveCaptureState) from "completedAt" and the
-- linked PlannedActivity's status. "completedAt" is the durable completion
-- fact: because "plannedActivityId" is ON DELETE SET NULL, a completed
-- Capture must never depend on its plan still existing.
--
-- "plannedActivityId" points AT "PlannedActivity" and is UNIQUE (0..1
-- cardinality). "PlannedActivity" itself gains NO column -- same
-- one-directional shape as "GoalActivity" (migration 0035).
--
-- Additive only: no existing table/column touched, no backfill.

CREATE TABLE "Capture" (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN',
  "completedAt" TIMESTAMPTZ(3),
  "plannedActivityId" TEXT UNIQUE REFERENCES "PlannedActivity"(id) ON DELETE SET NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);

CREATE INDEX "Capture_userId_status_createdAt_idx" ON "Capture"("userId", status, "createdAt");
