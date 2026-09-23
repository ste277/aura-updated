-- Goals -> Planning Integration V1 PR A: the persistent Goal domain
-- underneath Aura (architecture audit + implementation design, both
-- AUDIT-ONLY/DESIGN-ONLY tickets that made no schema change themselves).
--
-- Goal is a user-owned, long-lived objective. No persisted COMPLETED
-- state -- a Goal can always produce more GoalActivities later, so "all
-- current activities done" is never treated as proof the Goal itself is
-- finished. targetDate is a civil DATE (never an instant), same
-- convention as "DailyReflection"."reflectionDate".
--
-- GoalActivity persists ONLY two real lifecycle states (SUGGESTED /
-- DISMISSED). SELECTED (a mid Plan-My-Day-session choice) is deliberately
-- never stored here at all -- client-local only. PLANNED/COMPLETED are
-- deliberately never stored either: both are derived by joining
-- "plannedActivityId"'s linked PlannedActivity.status (see
-- apps/web/lib/goals.ts's deriveGoalActivityState), so they can never
-- drift from what actually happened. activityId stays a plain TEXT
-- column (no FK) -- same convention as "HabitLog"."activityId" and
-- "PlannedActivity"."activityId", since the activity catalog is a
-- code-defined constant, not a database table.
--
-- "plannedActivityId" is the ONLY persisted link between a GoalActivity
-- and a real commitment, and it points AT "PlannedActivity" -- never the
-- reverse. "PlannedActivity" itself gains NO new column from this
-- migration (confirmed via `prisma migrate diff --from-empty` against a
-- minimal candidate schema before this migration was written): Prisma's
-- relation validator requires a back-relation navigation field on the
-- PlannedActivity model block in schema.prisma (error P1012 without it),
-- but that field is a Prisma-Client-type-only construct with zero
-- database footprint -- the FK column and constraint below live entirely
-- on "GoalActivity". This preserves the existing house rule
-- ("PlannedActivity stays completely unaware of acquisition source",
-- migration 0025's own doc comment) at the actual database level; no
-- application code reads PlannedActivity's Prisma-only back-relation
-- field, and this hand-written raw-SQL migration never touches
-- "PlannedActivity" at all.
--
-- UNIQUE on "plannedActivityId" enforces the 0..1 cardinality (one
-- PlannedActivity claimed by at most one GoalActivity) at the database
-- level. ON DELETE SET NULL so a hard-deleted PlannedActivity (only ever
-- LOGGED/CANCELLED rows, see deletePlannedActivity) cleanly unlinks
-- rather than leaving a dangling reference.
--
-- Additive only: no existing table/column touched, no backfill, no data
-- migrated.

CREATE TABLE "Goal" (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  "targetDate" DATE,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "archivedAt" TIMESTAMPTZ(3)
);

CREATE INDEX "Goal_userId_status_idx" ON "Goal"("userId", status);

CREATE TABLE "GoalActivity" (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "goalId" TEXT NOT NULL REFERENCES "Goal"(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  "activityId" TEXT,
  status TEXT NOT NULL DEFAULT 'SUGGESTED',
  "plannedActivityId" TEXT UNIQUE REFERENCES "PlannedActivity"(id) ON DELETE SET NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);

CREATE INDEX "GoalActivity_userId_goalId_status_idx" ON "GoalActivity"("userId", "goalId", status);
