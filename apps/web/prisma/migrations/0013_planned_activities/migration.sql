CREATE TABLE IF NOT EXISTS "PlannedActivity" (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,

  title TEXT NOT NULL,
  "activityType" TEXT,
  icon TEXT,
  status TEXT NOT NULL DEFAULT 'UPCOMING',

  "plannedStartAt" TIMESTAMPTZ(3) NOT NULL,
  "plannedEndAt" TIMESTAMPTZ(3) NOT NULL,
  "durationMinutes" INTEGER NOT NULL,

  "windowType" TEXT NOT NULL,
  "windowLabel" TEXT,
  "matchLabel" TEXT,
  score INTEGER,
  recommendation TEXT,
  "calendarUrl" TEXT,

  "loggedAt" TIMESTAMPTZ(3),
  "habitLogId" TEXT REFERENCES "HabitLog"(id) ON DELETE SET NULL,

  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "PlannedActivity_userId_plannedStartAt_idx"
  ON "PlannedActivity" ("userId", "plannedStartAt");

CREATE INDEX IF NOT EXISTS "PlannedActivity_userId_status_idx"
  ON "PlannedActivity" ("userId", status);
