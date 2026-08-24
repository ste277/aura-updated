-- Intentional Day Builder V1 -- Add idempotency (brief section 20) + Day
-- Builder preferences (brief section 6/35).
--
-- PlanCreationIdempotency mirrors GuestConversionRedemption's own "claim,
-- then fill" design (migration 0024) rather than adding an
-- acquisition-source column to PlannedActivity itself -- that table's own
-- doc comment already establishes "PlannedActivity stays completely
-- unaware of acquisition source" as the house rule, so a Day Builder Add
-- idempotency key follows the same separate-table pattern instead of
-- breaking it. Unlike GuestConversionRedemption's tokenHash (a
-- cryptographically random, globally-unique value), Day Builder's
-- clientRequestId is deterministically derived from (suggestion id, local
-- date) on the client -- NOT globally unique across users -- so the key here
-- is a composite (userId, clientRequestId), not clientRequestId alone.
CREATE TABLE "PlanCreationIdempotency" (
  "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "clientRequestId" TEXT NOT NULL,
  "plannedActivityId" TEXT REFERENCES "PlannedActivity"(id) ON DELETE CASCADE,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("userId", "clientRequestId")
);

-- Day Builder preferences (brief section 6/35) -- deliberately minimal, same
-- restraint as Aura Reminders V1's own remindersEnabled/reminderLeadMinutes
-- pair: a master on/off switch, plus which of the taxonomy's real
-- DailyIntentionGroupId groups (dailyIntentions.ts) the user has muted from
-- proactive suggestions. No per-activity config, no weighting/ranking
-- knobs -- future personalization is explicitly out of scope for V1 (brief
-- section 7).
ALTER TABLE "User" ADD COLUMN "dayBuilderEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "dayBuilderMutedGroups" TEXT[] NOT NULL DEFAULT '{}';
