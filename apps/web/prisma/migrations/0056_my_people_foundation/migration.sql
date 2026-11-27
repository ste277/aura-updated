-- AURA-MP-1: My People data foundation (design AURA-MP-01, D1-D10 + R1-R3).
--
-- Additive and relaxing only. No existing row is rewritten or backfilled:
-- every current SavedPerson keeps its full chart details, and every new
-- column is nullable or has a constant default.
--
-- Migration number: 0055_auth_session is reserved for AUTH-SESSION-01 I1
-- (owner-confirmed 2026-11-27), so My People uses 0056. R1 (62007) amended
-- the PersonOccasion CHECKs before 0056 was applied to any persistent
-- environment (verified 2026-11-27: no Production build with 0056, Preview
-- builds skip migrations, no local persistent database has it). R2 (62009)
-- amended the same CHECK again after re-verifying that 0056 is still
-- unapplied to any persistent environment. Neither migration touches the
-- other's tables, and `prisma migrate deploy` applies any unapplied
-- migration regardless of which one lands first.

-- 1. SavedPerson: chart details become optional, but stay all-or-none.
ALTER TABLE "SavedPerson" ALTER COLUMN "birthDate" DROP NOT NULL;
ALTER TABLE "SavedPerson" ALTER COLUMN "birthTime" DROP NOT NULL;
ALTER TABLE "SavedPerson" ALTER COLUMN "birthTimezone" DROP NOT NULL;
ALTER TABLE "SavedPerson" ADD CONSTRAINT "SavedPerson_chart_all_or_none"
  CHECK (
    ("birthDate" IS NULL AND "birthTime" IS NULL AND "birthTimezone" IS NULL)
    OR ("birthDate" IS NOT NULL AND "birthTime" IS NOT NULL AND "birthTimezone" IS NOT NULL)
  );

-- 2. SavedPerson: new optional My People fields. notes is private free text.
ALTER TABLE "SavedPerson" ADD COLUMN "relationshipLabel" TEXT;
ALTER TABLE "SavedPerson" ADD COLUMN "locationName" TEXT;
ALTER TABLE "SavedPerson" ADD COLUMN "timezone" TEXT;
ALTER TABLE "SavedPerson" ADD COLUMN "interests" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "SavedPerson" ADD COLUMN "notes" TEXT;

-- Target of PersonOccasion's composite owner FK below. id is already the
-- primary key, so this adds no new uniqueness, only an FK target.
ALTER TABLE "SavedPerson" ADD CONSTRAINT "SavedPerson_id_ownerUserId_key" UNIQUE (id, "ownerUserId");

-- 3. PersonOccasion: a person's special days (birthday, anniversary, other).
-- The composite FK means the database itself can never file a special day
-- under another user's person. `calendar` exists from day one so that future
-- calendar types (e.g. tithi-dated days, R3) only widen these CHECKs. month
-- and day are therefore required by a calendar-specific CHECK, not NOT NULL.
CREATE TABLE "PersonOccasion" (
  id TEXT PRIMARY KEY,
  "ownerUserId" TEXT NOT NULL,
  "savedPersonId" TEXT NOT NULL,
  kind TEXT NOT NULL,
  label TEXT,
  calendar TEXT NOT NULL DEFAULT 'GREGORIAN',
  month INTEGER,
  day INTEGER,
  year INTEGER,
  "remindDaysBefore" INTEGER DEFAULT 7,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT "PersonOccasion_person_owner_fkey"
    FOREIGN KEY ("savedPersonId", "ownerUserId")
    REFERENCES "SavedPerson"(id, "ownerUserId") ON DELETE CASCADE,
  CONSTRAINT "PersonOccasion_kind_check" CHECK (kind IN ('BIRTHDAY', 'ANNIVERSARY', 'OTHER')),
  CONSTRAINT "PersonOccasion_calendar_check" CHECK (calendar IN ('GREGORIAN')),
  -- R1 F4: real calendar dates enforced by the database itself, so no
  -- writer and no concurrent interleaving can ever persist 31 Apr, 30 Feb,
  -- or 29 Feb in a known non-leap year. An unknown year (NULL) keeps 29 Feb
  -- valid; it is observed on 28 Feb in non-leap years at read time.
  -- R2 F4 (62009): month and day are required EXPLICITLY. A PostgreSQL
  -- CHECK passes when its expression is UNKNOWN, so without these IS NOT
  -- NULL terms a NULL month or day made every comparison below NULL and the
  -- row was accepted. The year stays optional (NULL = unknown year).
  CONSTRAINT "PersonOccasion_gregorian_date_check" CHECK (
    calendar <> 'GREGORIAN'
    OR (
      month IS NOT NULL
      AND day IS NOT NULL
      AND month BETWEEN 1 AND 12
      AND day >= 1
      AND day <= CASE WHEN month = 2 THEN 29 WHEN month IN (4, 6, 9, 11) THEN 30 ELSE 31 END
      AND NOT (
        month = 2 AND day = 29 AND year IS NOT NULL
        AND NOT ((year % 4 = 0 AND year % 100 <> 0) OR year % 400 = 0)
      )
    )
  ),
  CONSTRAINT "PersonOccasion_year_check" CHECK (year IS NULL OR year >= 1900),
  CONSTRAINT "PersonOccasion_other_label_check" CHECK (kind <> 'OTHER' OR (label IS NOT NULL AND length(btrim(label)) > 0)),
  CONSTRAINT "PersonOccasion_remind_days_check" CHECK ("remindDaysBefore" IS NULL OR "remindDaysBefore" BETWEEN 0 AND 30)
);

CREATE INDEX "PersonOccasion_ownerUserId_idx" ON "PersonOccasion" ("ownerUserId");
CREATE INDEX "PersonOccasion_savedPersonId_idx" ON "PersonOccasion" ("savedPersonId");
-- At most one birthday per person.
CREATE UNIQUE INDEX "PersonOccasion_one_birthday_per_person"
  ON "PersonOccasion" ("savedPersonId") WHERE kind = 'BIRTHDAY';

-- 4. PlannedActivity: optional link to a person. It is written only when
-- My People is enabled. Deleting the person keeps the plan and clears the link.
ALTER TABLE "PlannedActivity" ADD COLUMN "savedPersonId" TEXT
  REFERENCES "SavedPerson"(id) ON DELETE SET NULL;
CREATE INDEX "PlannedActivity_userId_savedPersonId_idx"
  ON "PlannedActivity" ("userId", "savedPersonId") WHERE "savedPersonId" IS NOT NULL;
