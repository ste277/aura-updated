-- Goals V2 G2.2.1: the inert persistence foundation for a durable
-- execution/progress fact tied to one GoalActivity occurrence (architecture
-- audit + this implementation ticket, both against G2.1 HEAD
-- 29b1c298fc028c6fa31afa995c8cd67f0bc6a742). Schema/domain-only -- no
-- production code path creates, updates, reads, or displays a row of this
-- table yet.
--
-- WHY A NEW TABLE, NOT COLUMNS ON "PlannedActivity": the G2.2 architecture
-- audit traced Move's actual mechanics (apps/web/lib/planMove.ts) and found
-- PlannedActivity is a DISPOSABLE schedule placement, not an enduring
-- occurrence identity -- Move cancels the original row in place (status ->
-- MOVED) and INSERTS a brand-new row for the live successor, with an
-- explicit column list that does not carry forward completion facts. A
-- progress value stored directly on PlannedActivity would therefore be
-- silently lost across a Move. Keying this table to "GoalActivity" instead
-- (the thing Move already REPOINTS rather than recreates, exactly like
-- "Capture") makes it survive Move automatically.
--
-- SCOPE: occurrence-bound only (Workout 30 minutes, Read 20 pages).
-- Deliberately no day-bucket/localDate/recurrence concept -- day-
-- accumulating targets (Drink 8 glasses, Walk 6000 steps) remain valid
-- CompletionRequirement kinds (G2.1) but stay progress-inert until a
-- future, separate day-scoped design exists.
--
-- CARDINALITY: many "GoalActivityExecution" rows may belong to one
-- "GoalActivity" over time (one per real occurrence across replans/Moves --
-- this is what eventually answers "how many workouts this week" without
-- needing GoalActivity's own 0..1 plannedActivityId to carry history).
-- "plannedActivityId" is UNIQUE so one live PlannedActivity can never be
-- claimed by more than one execution record at once -- same invariant
-- "GoalActivity.plannedActivityId" and "Capture.plannedActivityId" already
-- enforce for their own live links.
--
-- FK BEHAVIOR: "goalActivityId" CASCADEs (an execution fact has no
-- independent meaning once its own GoalActivity is gone -- same convention
-- "Goal" -> "GoalActivity" already uses). "plannedActivityId" SET NULLs on
-- delete (same convention "GoalActivity.plannedActivityId" and
-- "Capture.plannedActivityId" already use) -- so deletePlannedActivity's
-- existing, already-shipped hard-delete of an old LOGGED/CANCELLED plan
-- (users clearing "Recently Completed") cleanly unlinks rather than
-- destroying the historical execution fact; its snapshot + currentValue
-- remain queryable afterward with plannedActivityId simply NULL.
--
-- SNAPSHOT FIELDS: "completionKindSnapshot"/"completionTargetValueSnapshot"/
-- "completionUnitSnapshot" capture GoalActivity's CompletionRequirement (G2.1)
-- AT THE MOMENT an execution is created -- never re-derived from the live
-- GoalActivity later, so an edited target can never silently rewrite
-- history.
--
-- "currentValue" is DOUBLE PRECISION (not INTEGER), same fractional-
-- preserving convention as "GoalActivity"."completionTargetValue" -- never
-- clamped to the snapshotted target.
--
-- "source" is a deliberately loose, nullable TEXT column -- there is no
-- existing canonical shared TS type for "HabitLog"."logSource" to reuse (it
-- is repeated inline at each call site in db.ts, never exported as one
-- type); this column is intended to draw from that SAME conceptual
-- vocabulary, without inventing connector-specific values ahead of any
-- actual connector existing.
--
-- No "status"/"completed"/"isComplete"/"completedAt" column: existing
-- "PlannedActivity".status/"loggedAt" remain the sole completion truth for
-- this scope -- this table stores measurement/history, not a second,
-- competing lifecycle.
--
-- Additive only: no existing table/column touched, no backfill, no data
-- migrated. No change to "Goal", "GoalActivity" (beyond this migration's own
-- new inbound relation, which is a Prisma-only navigation concept with zero
-- column footprint on that table), "PlannedActivity", "Habit", or
-- "HabitLog".

CREATE TABLE "GoalActivityExecution" (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "goalActivityId" TEXT NOT NULL REFERENCES "GoalActivity"(id) ON DELETE CASCADE,
  "plannedActivityId" TEXT UNIQUE REFERENCES "PlannedActivity"(id) ON DELETE SET NULL,
  "completionKindSnapshot" TEXT NOT NULL,
  "completionTargetValueSnapshot" DOUBLE PRECISION,
  "completionUnitSnapshot" TEXT,
  "currentValue" DOUBLE PRECISION,
  "source" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);

CREATE INDEX "GoalActivityExecution_userId_goalActivityId_idx" ON "GoalActivityExecution"("userId", "goalActivityId");
