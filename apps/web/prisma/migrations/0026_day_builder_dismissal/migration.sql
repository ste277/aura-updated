-- Day Builder -- "Not today" dismissal support.
--
-- A small, scoped side table (same convention as GuestConversionRedemption
-- and PlanCreationIdempotency) rather than a column on PlannedActivity or
-- on the activity catalog: a dismissal has NOTHING to do with acquisition
-- source or catalog metadata -- it's purely "don't propose this exact
-- (activity, person) pairing to this user again today."
--
-- personId is NOT NULL with a '' sentinel for "no person" (rather than a
-- nullable column) so the composite PRIMARY KEY behaves correctly --
-- Postgres treats NULL <> NULL for uniqueness purposes, which would have
-- silently allowed duplicate no-person dismissal rows for the same
-- (userId, localDate, activityId).
--
-- localDate (not a DATE/TIMESTAMPTZ column) is the user's own LOCAL
-- calendar date string ('YYYY-MM-DD', same as DailyAgenda.localDate) --
-- rollover to a new local day is then just "the WHERE clause no longer
-- matches", with no cleanup job needed for a dismissal to naturally expire.
CREATE TABLE "DayBuilderDismissal" (
  "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "localDate" TEXT NOT NULL,
  "activityId" TEXT NOT NULL,
  "personId" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("userId", "localDate", "activityId", "personId")
);

CREATE INDEX "DayBuilderDismissal_owner_date_idx" ON "DayBuilderDismissal"("userId", "localDate");
