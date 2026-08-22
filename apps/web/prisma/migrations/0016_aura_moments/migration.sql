-- Aura Moment Sharing V1: a snapshot of a selected Muhurtham recommendation,
-- shared via an opaque public token. Never re-runs Muhurtham Finder / natal
-- calculation on read -- the row itself IS the display payload.
CREATE TABLE "AuraMoment" (
    "id"                      TEXT NOT NULL PRIMARY KEY,
    "ownerUserId"             TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "publicToken"             TEXT NOT NULL,

    "scope"                   TEXT NOT NULL, -- 'GENERAL' | 'PERSONAL' | 'SHARED'
    "activityId"              TEXT NOT NULL,
    "activityTitle"           TEXT NOT NULL,
    "activityIcon"            TEXT,

    "startAt"                 TIMESTAMPTZ(3) NOT NULL,
    "endAt"                   TIMESTAMPTZ(3) NOT NULL,
    "timezone"                TEXT NOT NULL,

    -- SHARED scope only. ON DELETE SET NULL, not CASCADE: this row is a
    -- historical snapshot ("what Aura recommended when this was shared") --
    -- deleting the SavedPerson later must not delete the moment record.
    "savedPersonId"           TEXT REFERENCES "SavedPerson"("id") ON DELETE SET NULL,
    "sharedPersonDisplayName" TEXT,
    "senderDisplayName"       TEXT,

    "ratingLabel"             TEXT,
    "explanationSnapshot"     TEXT,

    "status"                  TEXT NOT NULL DEFAULT 'ACTIVE', -- 'ACTIVE' | 'REVOKED'
    "responseState"           TEXT, -- NULL | 'ACCEPTED' | 'ANOTHER_TIME'
    "respondedAt"             TIMESTAMPTZ(3),

    "createdAt"               TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    "expiresAt"               TIMESTAMPTZ(3),

    CONSTRAINT "AuraMoment_scope_check" CHECK ("scope" IN ('GENERAL', 'PERSONAL', 'SHARED')),
    CONSTRAINT "AuraMoment_status_check" CHECK ("status" IN ('ACTIVE', 'REVOKED')),
    CONSTRAINT "AuraMoment_responseState_check" CHECK ("responseState" IS NULL OR "responseState" IN ('ACCEPTED', 'ANOTHER_TIME'))
);

-- The token is the sole public lookup key -- must be unique, and looked up
-- frequently (every public page view / response), so it gets its own index.
CREATE UNIQUE INDEX "AuraMoment_publicToken_key" ON "AuraMoment"("publicToken");
CREATE INDEX "AuraMoment_ownerUserId_idx" ON "AuraMoment"("ownerUserId");
