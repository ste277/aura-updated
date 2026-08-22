-- Product Instrumentation V1: a small first-party event system.
--
-- ProductEvent is intentionally generic (eventName + a tightly allow-listed
-- metadata JSON) rather than one table per event type -- this is a low-volume
-- funnel-measurement log, not a transactional record; a single table keeps
-- the retention/query story simple. See apps/web/lib/productEvents.ts for
-- the closed event-name vocabulary and per-event metadata validation that
-- guards every write to this table (the DB schema alone does not enforce
-- which keys `metadata` may contain -- that enforcement lives in
-- application code, deliberately, so it can be unit-tested without a
-- database).
CREATE TABLE "ProductEvent" (
    "id"           TEXT NOT NULL PRIMARY KEY,
    "eventName"    TEXT NOT NULL,
    -- Authenticated Aura user only. NULL for anonymous public-page events
    -- (e.g. AURA_MOMENT_FIND_YOUR_OWN_CLICKED, fired from the logged-out
    -- /moment/[token] page). ON DELETE CASCADE matches every other
    -- user-owned row in this schema (AuraMoment, SavedPerson, etc.).
    "userId"       TEXT REFERENCES "User"("id") ON DELETE CASCADE,
    -- The AuraMoment's INTERNAL id, never its publicToken (brief section 3:
    -- "auraMomentId // internal DB id, never public token"). ON DELETE SET
    -- NULL rather than CASCADE: a moment is never hard-deleted in this app
    -- (only revoked), so this is purely defensive.
    "auraMomentId" TEXT REFERENCES "AuraMoment"("id") ON DELETE SET NULL,
    "metadata"     JSONB NOT NULL DEFAULT '{}',
    "createdAt"    TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);

-- Every metrics query filters by eventName + a createdAt time window, or
-- groups by eventName within that window -- this one composite index covers
-- both access patterns.
CREATE INDEX "ProductEvent_eventName_createdAt_idx" ON "ProductEvent"("eventName", "createdAt" DESC);
CREATE INDEX "ProductEvent_userId_idx" ON "ProductEvent"("userId") WHERE "userId" IS NOT NULL;
CREATE INDEX "ProductEvent_auraMomentId_idx" ON "ProductEvent"("auraMomentId") WHERE "auraMomentId" IS NOT NULL;

-- "Shared -> opened" without refresh inflation (brief section 6): the FIRST
-- successful public open of a moment, set once and never again. The
-- AURA_MOMENT_OPENED event itself is only ever recorded when this UPDATE
-- actually changes a row (see the public page's own code) -- later
-- refreshes see firstOpenedAt already set and record nothing.
ALTER TABLE "AuraMoment" ADD COLUMN "firstOpenedAt" TIMESTAMPTZ(3);
