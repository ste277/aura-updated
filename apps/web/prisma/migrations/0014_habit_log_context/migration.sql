ALTER TABLE "HabitLog"
  ADD COLUMN IF NOT EXISTS "logSource" TEXT NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN IF NOT EXISTS "activitySignificance" TEXT NOT NULL DEFAULT 'MEDIUM';

CREATE INDEX IF NOT EXISTS "HabitLog_userId_logSource_idx"
  ON "HabitLog" ("userId", "logSource");
