CREATE TABLE IF NOT EXISTS "CustomCity" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
    "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "cityName" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "timezone" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomCity_userId_cityName_key" UNIQUE ("userId", "cityName")
);

CREATE INDEX IF NOT EXISTS "CustomCity_userId_idx" ON "CustomCity"("userId");