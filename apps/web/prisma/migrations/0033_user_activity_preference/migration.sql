-- Explicit Duration Preferences Foundation V1: one row per (userId,
-- activityId) ONLY when the user has explicitly declared how long they
-- usually want to spend on that activity. Row absence IS the "no
-- preference" state. activityId stays a plain TEXT column (no FK) --
-- same convention as "HabitLog"."activityId" and
-- "PlannedActivity"."activityId", since the activity catalog is a
-- code-defined constant, not a database table. Additive only: no backfill,
-- no existing table/column touched.
CREATE TABLE "UserActivityPreference" (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "activityId" TEXT NOT NULL,
  "preferredDurationMinutes" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  UNIQUE ("userId", "activityId")
);

CREATE INDEX "UserActivityPreference_userId_idx" ON "UserActivityPreference"("userId");
