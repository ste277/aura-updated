CREATE TABLE IF NOT EXISTS "SavedPerson" (
  id TEXT PRIMARY KEY,
  "ownerUserId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,

  name TEXT NOT NULL,
  "relationshipType" TEXT NOT NULL DEFAULT 'OTHER',

  "birthDate" TIMESTAMPTZ(3) NOT NULL,
  "birthTime" TEXT NOT NULL,
  "birthTimezone" TEXT NOT NULL,
  "birthCityName" TEXT,
  "birthLatitude" DOUBLE PRECISION,
  "birthLongitude" DOUBLE PRECISION,

  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "SavedPerson_ownerUserId_idx"
  ON "SavedPerson" ("ownerUserId");
