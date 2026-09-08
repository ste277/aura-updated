-- Good Right Now / Log Activity Failure State Correctness V1 -- a stable,
-- client-generated identifier a direct HabitLog creation request can carry
-- so an ambiguous network failure (request reached the server and
-- committed, but the response never reached the client) can be safely
-- retried/replayed from the offline queue without creating a duplicate
-- row. Nullable, no default, no backfill: NULL on every existing row and
-- on any future request that legitimately omits it (nothing about this
-- column is required) -- same discipline as activityId's own doc comment
-- on this table.
--
-- Partial unique index, not a plain one: Postgres already treats NULL <>
-- NULL in a unique index, so a plain unique index on (userId,
-- clientRequestId) would already allow unlimited NULL rows per user --
-- but the WHERE clause makes that intent explicit and self-documenting
-- (same precedent as migration 0018's partial index on AuraMoment), and
-- scopes the dedup guarantee to one user's own requests only, never
-- across users.
ALTER TABLE "HabitLog" ADD COLUMN "clientRequestId" TEXT;
CREATE UNIQUE INDEX "HabitLog_userId_clientRequestId_key" ON "HabitLog"("userId", "clientRequestId") WHERE "clientRequestId" IS NOT NULL;
