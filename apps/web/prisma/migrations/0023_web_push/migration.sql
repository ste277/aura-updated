-- Web Push V1: browser push subscription persistence + claim-based
-- concurrency safety for ReminderDelivery (brief section 3/22/23).

-- PushSubscription -- one row per browser/device registration. `endpoint`
-- is globally unique (a push endpoint URL is provider-issued and
-- effectively identifies one browser subscription slot) -- re-registering
-- the same endpoint (e.g. the same browser tab re-subscribing) upserts in
-- place rather than accumulating duplicate rows (brief section 4).
CREATE TABLE "PushSubscription" (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  "userAgent" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "lastSuccessfulAt" TIMESTAMPTZ(3),
  "disabledAt" TIMESTAMPTZ(3),
  UNIQUE (endpoint)
);

CREATE INDEX "PushSubscription_owner_idx" ON "PushSubscription"("userId");

-- ReminderDelivery gains claim-transition + retry-bookkeeping columns
-- (brief section 22/23): status now also supports "PROCESSING" (claimed by
-- a worker, about to send -- the atomic UPDATE ... WHERE status = 'PENDING'
-- this transition requires is what makes concurrent workers safe, not just
-- the existing creation-time uniqueness) and "SKIPPED" (the occurrence was
-- no longer eligible by send time -- rescheduled, revoked, or superseded;
-- brief section 24/25). attemptCount/lastAttemptAt support a future bounded
-- retry without a queue.
ALTER TABLE "ReminderDelivery" ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ReminderDelivery" ADD COLUMN "lastAttemptAt" TIMESTAMPTZ(3);
