-- Insights V1 PR6 -- Durable Completion Attribution. Four additive,
-- nullable columns on HabitLog so a confirmed completion's scheduled-date
-- and Goal attribution survive deletePlannedActivity's hard-delete of the
-- originating PlannedActivity -- see AURA_INSIGHTS_PR6_COMPLETION_
-- EVIDENCE_DECISION.md for the full design and AURA_INSIGHTS_PR6_
-- ARCHITECTURE_AUDIT.md for why this -- extending the one table that
-- already durably represents a confirmed completion -- was chosen over a
-- generic event log, a parallel non-Goal completion model, or a
-- PlannedActivity tombstone.
--
-- ADDITIVE ONLY, NO BACKFILL BY THIS MIGRATION: NULL for every existing
-- row -- the same "never fabricate a link that was never captured"
-- precedent migration 0046 (movedAt), 0047 (scheduledWeekStart/
-- scheduledWeekTimezone), and 0048 (goalActivityOccurrenceId) already
-- established. All four columns are always written TOGETHER, in the SAME
-- statement, by the ONE canonical writer (logPlannedActivity,
-- apps/web/lib/db.ts) -- a row with some but not all of them set is an
-- impossible, corrupt state no reader should ever need to handle.
--
-- originatingPlannedActivityId / originatingGoalActivityExecutionId are
-- deliberately PLAIN TEXT columns, NOT foreign keys: both referenced rows
-- (PlannedActivity, GoalActivityExecution) must remain identifiable here
-- even after they are themselves hard-deleted, which no onDelete action
-- (SetNull or Cascade) would allow -- a SetNull would silently destroy
-- the very evidence this migration exists to preserve the instant the
-- Plan is deleted, defeating its own purpose. This is the opposite
-- reasoning from HabitLog.activityId's own "not a foreign key" precedent
-- (a static catalog that isn't a Prisma model at all) but reaches the
-- same structural choice.
--
-- completionAttribution is NULLABLE by design: NULL means UNKNOWN_LEGACY
-- (a row written before this migration), a real, distinct, deliberately
-- EXCLUDED third state -- application code must never silently treat
-- NULL as 'NON_GOAL'. Values are 'GOAL_LINKED' | 'NON_GOAL', enforced at
-- the application layer (logPlannedActivity), not a DB CHECK constraint
-- -- same convention as every other string-enum column in this schema
-- (status, logSource, rhythmKind, etc.), none of which use a DB-level
-- CHECK either.
--
-- scheduledStartAtSnapshot is PlannedActivity.plannedStartAt, read
-- inside logPlannedActivity's own transaction at the exact moment of
-- completion -- never backfilled from logTimestamp (the real completion
-- instant, a materially different fact -- confirmed by live reproduction
-- in the PR6 blocked-implementation report that these two timestamps can
-- differ by months) and never re-derived from the user's timezone at
-- read time (Timestamptz, an absolute instant).

ALTER TABLE "HabitLog"
  ADD COLUMN "originatingPlannedActivityId" TEXT,
  ADD COLUMN "scheduledStartAtSnapshot" TIMESTAMPTZ(3),
  ADD COLUMN "completionAttribution" TEXT,
  ADD COLUMN "originatingGoalActivityExecutionId" TEXT;

-- Covers the Insights reporting fallback's own exact access pattern
-- (userId + attribution + range-bounded scheduled date) in one index.
CREATE INDEX "HabitLog_userId_completionAttribution_scheduledStartAtSnap_idx"
  ON "HabitLog" ("userId", "completionAttribution", "scheduledStartAtSnapshot");

-- Defensive backstop: at most one HabitLog per originating Plan per user.
-- NOT load-bearing for correctness (logPlannedActivity's own idempotent-
-- retry short-circuit already makes a second write for the same Plan
-- structurally unreachable) -- a cheap, standard DB-level backstop
-- against a future application bug, matching the EXACT precedent
-- HabitLog.clientRequestId's own partial unique index (migration 0032)
-- already established in this schema. Partial, not a plain UNIQUE
-- column constraint, since the column is NULL for every non-AURA_PLANNED
-- HabitLog (manual/do-now/custom-habit logs never set it) and for every
-- legacy row -- Prisma's schema DSL has no partial-index syntax, so (same
-- precedent) this lives only in raw migration SQL, not in schema.prisma.
CREATE UNIQUE INDEX "HabitLog_userId_originatingPlannedActivityId_key"
  ON "HabitLog" ("userId", "originatingPlannedActivityId")
  WHERE "originatingPlannedActivityId" IS NOT NULL;

-- Speeds the reporting fallback's own correlated NOT EXISTS subquery
-- against PlannedActivity ("does a live Plan still reference this
-- HabitLog") -- no index previously existed on this FK column at all.
-- Partial (only non-null habitLogId values are ever queried this way).
CREATE INDEX "PlannedActivity_habitLogId_idx"
  ON "PlannedActivity" ("habitLogId")
  WHERE "habitLogId" IS NOT NULL;
