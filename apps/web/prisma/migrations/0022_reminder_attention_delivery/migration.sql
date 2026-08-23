-- Notification Delivery Readiness V1: separates reminder RELEVANCE (still
-- computed live by deriveAuraReminders(), unchanged) from reminder SEEN
-- state, and prepares idempotent delivery-tracking for a future Web Push
-- worker. No push is sent by this migration or this PR.

-- ReminderAttention: "has the owner acknowledged THIS reminder occurrence
-- in Aura" -- identified by (userId, scheduledItemType, scheduledItemId,
-- reminderAt), never a bare boolean on the source row. A rescheduled
-- Plan/Moment produces a NEW reminderAt, so its next occurrence has no
-- matching row here and is unread again with no extra write anywhere --
-- the same "derive unread by comparison, don't store a boolean" pattern
-- ownerSeenResponseAt already established (migration 0018), just keyed to
-- a specific occurrence instead of "the current state."
CREATE TABLE "ReminderAttention" (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "scheduledItemType" TEXT NOT NULL, -- "PLANNED_ACTIVITY" | "AURA_MOMENT"
  "scheduledItemId" TEXT NOT NULL,
  "reminderAt" TIMESTAMPTZ(3) NOT NULL,
  "seenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  UNIQUE ("userId", "scheduledItemType", "scheduledItemId", "reminderAt")
);

CREATE INDEX "ReminderAttention_owner_idx" ON "ReminderAttention"("userId", "scheduledItemType", "scheduledItemId");

-- ReminderDelivery: idempotent delivery-attempt tracking for a future Web
-- Push worker -- NOT reminder relevance, NOT seen state (these three stay
-- strictly separate). The uniqueness constraint is what makes claiming
-- safe under concurrent workers: an INSERT ... ON CONFLICT DO NOTHING
-- against this same constraint guarantees the same reminder occurrence
-- never produces two WEB_PUSH sends, without any in-memory locking. No
-- worker exists yet -- this table is written to only by
-- ensureDueReminderDeliveries() when explicitly called (currently nothing
-- calls it in a live request path).
CREATE TABLE "ReminderDelivery" (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "scheduledItemType" TEXT NOT NULL,
  "scheduledItemId" TEXT NOT NULL,
  "reminderAt" TIMESTAMPTZ(3) NOT NULL,
  channel TEXT NOT NULL, -- "WEB_PUSH"
  status TEXT NOT NULL DEFAULT 'PENDING', -- "PENDING" | "SENT" | "FAILED"
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "sentAt" TIMESTAMPTZ(3),
  "failedAt" TIMESTAMPTZ(3),
  "failureReason" TEXT,
  UNIQUE ("userId", "scheduledItemType", "scheduledItemId", "reminderAt", channel)
);

CREATE INDEX "ReminderDelivery_status_idx" ON "ReminderDelivery"(status);
