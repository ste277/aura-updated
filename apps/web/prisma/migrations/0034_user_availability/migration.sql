-- Availability Context V1 PR H1: the UNCONFIGURED/CONFIGURED discriminant
-- (User.availabilityConfigured) plus normalized period storage
-- (UserAvailabilityPeriod). DEFAULT false on the ALTER TABLE applies to
-- every existing row automatically -- every current user becomes
-- UNCONFIGURED, never accidentally CONFIGURED, with no separate backfill
-- statement. Additive only: no existing table/column touched, no data
-- migrated.
ALTER TABLE "User" ADD COLUMN "availabilityConfigured" BOOLEAN NOT NULL DEFAULT false;

-- One row per saved usable period. weekday is 0 (Sunday) - 6 (Saturday).
-- startTime/endTime are "HH:mm" 24h civil-time strings, resolved against
-- User.timezone at read time -- no timezone/category/label/source column,
-- matching this milestone's own locked minimal scope. No uniqueness
-- constraint on weekday: multiple periods per weekday are expected (e.g. a
-- lunch gap), unlike UserActivityPreference's own (userId, activityId)
-- uniqueness.
CREATE TABLE "UserAvailabilityPeriod" (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL,
  "startTime" TEXT NOT NULL,
  "endTime" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);

CREATE INDEX "UserAvailabilityPeriod_userId_idx" ON "UserAvailabilityPeriod"("userId");
