-- Aura Reminders V1: time-based reminders for PlannedActivity and AuraMoment
-- (brief: "Aura should not stop after helping the user choose a time. It
-- should stay with the user until the activity happens.").
--
-- No new reminder/notification table -- audited first (brief section 1) and
-- confirmed every reminder is derivable on the fly from PlannedActivity/
-- AuraMoment (see lib/auraReminders.ts), the same "derive, don't persist"
-- pattern Aura Updates V1 already established (migration 0018). Only two
-- genuinely new pieces of state are needed:

-- 1. A user-level reminder preference (brief section 14) -- default ON,
-- default lead time 15 minutes before start.
ALTER TABLE "User" ADD COLUMN "remindersEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "reminderLeadMinutes" INTEGER NOT NULL DEFAULT 15;

-- 2. A minimal dedup linkage (brief section 7): PlanWithAuraView's
-- "Plan this" (POST /api/plans) and "Make this a Moment" (POST
-- /api/aura-moments) are independently clickable on the same search result,
-- with no existing linkage between the two tables -- so the SAME
-- real-world event can silently become two separate rows. Set ONLY when the
-- client can honestly know both ids: "Make this a Moment" clicked for a
-- candidate that was already saved as a Plan earlier in the same session
-- (see PlanWithAuraView's handleMakeMoment). Nullable and SET NULL on
-- delete -- a Moment must never become unreadable just because its linked
-- Plan was later deleted.
ALTER TABLE "AuraMoment" ADD COLUMN "plannedActivityId" TEXT REFERENCES "PlannedActivity"(id) ON DELETE SET NULL;

-- Powers deriveAuraReminders' bounded query (brief section 25: "don't load
-- all historical Plans/Moments") -- only moments whose startAt could
-- plausibly produce an active reminder right now, not full history.
CREATE INDEX "AuraMoment_owner_start_idx" ON "AuraMoment"("ownerUserId", "startAt");
