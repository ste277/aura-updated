CREATE TABLE "DailyReflection" (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "reflectionDate" DATE NOT NULL,
  "outputLevel" TEXT NOT NULL,
  "followedGuidance" BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "DailyReflection_userId_reflectionDate_key"
  ON "DailyReflection" ("userId", "reflectionDate");

CREATE INDEX "DailyReflection_userId_reflectionDate_idx"
  ON "DailyReflection" ("userId", "reflectionDate");
