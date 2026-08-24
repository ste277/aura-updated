-- Recipient Conversion V1 Hardening (brief section 10) -- idempotency for
-- the guest-conversion "restore candidate -> create PlannedActivity" step.
-- A dedicated table, not a column on PlannedActivity: PlannedActivity stays
-- completely unaware of acquisition source (brief section 2 -- no
-- isGuestPlan/convertedPlan field, no special rendering by source), and the
-- claim is atomic via a UNIQUE primary key + INSERT ... ON CONFLICT DO
-- NOTHING, the same "claim first" pattern ReminderDelivery's own
-- PENDING->PROCESSING transition already uses. "tokenHash" (not the raw
-- token) since the token itself already carries no sensitive data but there
-- is no reason to store it verbatim either.
CREATE TABLE "GuestConversionRedemption" (
  "tokenHash" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  -- Nullable: the row is inserted as a CLAIM the instant a save attempt
  -- starts (before the PlannedActivity exists), then filled in once
  -- creation succeeds. A row that stays null (a crashed/failed attempt) is
  -- treated as reclaimable by lib/db.ts's claimGuestConversionToken, never
  -- as a permanent block.
  "plannedActivityId" TEXT REFERENCES "PlannedActivity"(id) ON DELETE CASCADE,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);

CREATE INDEX "GuestConversionRedemption_owner_idx" ON "GuestConversionRedemption"("userId");
