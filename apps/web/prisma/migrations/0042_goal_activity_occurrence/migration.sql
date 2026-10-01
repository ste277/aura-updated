-- Goals V2 Rhythm R1: the architecture-foundation slice identified by the
-- G3.6 Rhythm architecture audit -- a stable identity for ONE CONCRETE
-- OCCURRENCE of a GoalActivity, introduced ALONGSIDE the existing
-- "GoalActivity"."plannedActivityId" 0..1 link (unchanged, still the sole
-- production link through G2.1-G3.5). Schema/domain-only -- no production
-- code path creates, updates, reads, or displays a row of this table yet.
--
-- WHY A NEW TABLE: neither "PlannedActivity" (disposable schedule
-- placement, hard-deletable) nor "GoalActivityExecution" (completion/
-- progress TRUTH, which must never represent "eligible but not yet
-- attempted") can safely double as a durable, queryable identity for
-- "which occurrence is this" once a GoalActivity can have more than one
-- occurrence over time (future Rhythm). This table exists only to hold
-- that identity.
--
-- NO STATUS COLUMN (deliberate): occurrence lifecycle is fully derivable
-- from its linked PlannedActivity's own status (UPCOMING/LOGGED/CANCELLED/
-- SKIPPED/MOVED), exactly the way GoalActivity's own derived state already
-- works (lib/goals.ts deriveGoalActivityState) -- duplicating that into a
-- second, independently-mutable column would create a second lifecycle
-- truth that could drift from the first. No demonstrated invariant in this
-- slice requires one.
--
-- NO windowKey COLUMN (deliberate): this ticket's own audit found the
-- earlier G3.6 proposal ("one occurrence per (goalActivityId, eligibility
-- window key)") wrong for N_PER_WEEK > 1 (three weekly sessions need three
-- occurrences inside the SAME window, distinguished by an ordinal, not
-- collapsed by one). Since the real future identity shape is not yet
-- decided, and a field named for a weekly/daily window would encode Rhythm
-- semantics this slice is explicitly forbidden from defining, no window/
-- idempotency field is added now.
--
-- CARDINALITY: many "GoalActivityOccurrence" rows may belong to one
-- "GoalActivity" over time -- the fundamental capability this migration
-- introduces. "plannedActivityId" is UNIQUE so one live PlannedActivity can
-- never be claimed by more than one occurrence at once -- same invariant
-- "GoalActivity"."plannedActivityId"/"GoalActivityExecution"."plannedActivityId"
-- already enforce for their own live links.
--
-- FK BEHAVIOR: "goalActivityId" CASCADEs (an occurrence has no independent
-- meaning once its own GoalActivity is gone -- same convention
-- "GoalActivityExecution"."goalActivityId" already uses). "plannedActivityId"
-- SET NULLs on delete (same convention every other plannedActivityId FK in
-- this schema already uses) so a hard-deleted old LOGGED/CANCELLED plan
-- cleanly unlinks rather than destroying the occurrence's own durable
-- identity.
--
-- Additive only: no existing table/column touched, no backfill, no data
-- migrated. Zero rows exist for any pre-existing GoalActivity after this
-- migration runs -- intentional.

CREATE TABLE "GoalActivityOccurrence" (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "goalActivityId" TEXT NOT NULL REFERENCES "GoalActivity"(id) ON DELETE CASCADE,
  "plannedActivityId" TEXT UNIQUE REFERENCES "PlannedActivity"(id) ON DELETE SET NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);

CREATE INDEX "GoalActivityOccurrence_userId_goalActivityId_idx" ON "GoalActivityOccurrence"("userId", "goalActivityId");
