-- Daily Experience V1 PR C1: Skip as a durable execution outcome.
--
-- "skippedAt" is the server-generated instant the user explicitly decided
-- not to perform a committed occurrence. It is set together with
-- status = 'SKIPPED' (plain text lifecycle column -- no enum change) and is
-- NULL for every other status. Invariants are enforced by
-- skipPlannedActivity's single conditional UPDATE, mirroring LOGGED/"loggedAt".
--
-- Additive only: one nullable column, no backfill (no historical row is ever
-- inferred to have been skipped).

ALTER TABLE "PlannedActivity"
ADD COLUMN "skippedAt" TIMESTAMPTZ(3);
