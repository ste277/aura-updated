-- Aura Moment Rescheduling V1: a structured recipient preference on top of
-- ANOTHER_TIME, plus a minimal lineage link so "Suggest this" can create a
-- brand-new AuraMoment rather than mutating the original historical
-- snapshot (brief section 13: "Historical shares should remain immutable
-- snapshots").
ALTER TABLE "AuraMoment" ADD COLUMN "responsePreference" TEXT; -- NULL | 'EARLIER' | 'LATER' | 'DIFFERENT_DAY' | 'NO_PREFERENCE'
ALTER TABLE "AuraMoment" ADD COLUMN "previousMomentId" TEXT REFERENCES "AuraMoment"("id") ON DELETE SET NULL;

ALTER TABLE "AuraMoment" ADD CONSTRAINT "AuraMoment_responsePreference_check"
  CHECK ("responsePreference" IS NULL OR "responsePreference" IN ('EARLIER', 'LATER', 'DIFFERENT_DAY', 'NO_PREFERENCE'));

-- Queried by hasSuccessorMoment() (apps/web/lib/db.ts) -- the public page
-- checks "has this moment already been superseded by a new suggestion" on
-- every view (brief section 15), so this lookup needs an index.
CREATE INDEX "AuraMoment_previousMomentId_idx" ON "AuraMoment"("previousMomentId");
