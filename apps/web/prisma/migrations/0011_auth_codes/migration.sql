-- One-time 6-digit sign-in codes. Needed because magic-link emails open in the
-- system browser, which strands the session cookie outside a native app's
-- webview — the code can be typed into whichever surface the user is on.
-- Server-side rows (rather than a pure signed token) give us attempt counting
-- and single-use semantics.
CREATE TABLE "AuthCode" (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "requestIp" TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "consumedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);

CREATE INDEX "AuthCode_email_createdAt_idx" ON "AuthCode" (email, "createdAt");
CREATE INDEX "AuthCode_requestIp_createdAt_idx" ON "AuthCode" ("requestIp", "createdAt");
