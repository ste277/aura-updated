-- Aura Updates V1: in-app owner attention state. Deliberately the smallest
-- possible addition -- no generic notifications table (audited: every field
-- an AuraUpdate needs is already derivable from AuraMoment itself, except
-- "has the owner seen this response yet", which needs exactly one new
-- timestamp). Unread is computed by comparing this to "respondedAt", not by
-- a separate boolean, so a NEW response after a previous "seen" mark is
-- correctly unread again without any extra write on the response path.
ALTER TABLE "AuraMoment" ADD COLUMN "ownerSeenResponseAt" TIMESTAMPTZ(3);

-- Powers the "recent responded moments" query the updates endpoint uses
-- (status + responseState + respondedAt ordering) instead of scanning every
-- moment the owner has ever created.
CREATE INDEX "AuraMoment_owner_response_idx" ON "AuraMoment"("ownerUserId", "status", "respondedAt" DESC) WHERE "responseState" IS NOT NULL;
