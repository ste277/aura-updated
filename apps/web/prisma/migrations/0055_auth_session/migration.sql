-- AURA-AUTH-SESSION-01-I1: the server-side session allowlist
-- (AURA_AUTH_SESSION_01_REVOCATION_DESIGN.md §2.1). One NEW table only: no
-- existing table, row or index changes, and no backfill. Nothing reads or
-- writes this table yet. Sign-in, logout and the existing as_session cookie
-- are unchanged until the separately authorized cutover (I2).
--
-- A session is valid only if its row exists, has not been revoked and has not
-- expired (allowlist: a missing row means "not authenticated", so deleting or
-- cleaning up rows can never re-enable a session).
--
-- "idHash" is base64url SHA-256 of the 256-bit random session id; the raw id
-- is never stored. "expiresAt" is set by the database (now() + 30 days) and
-- checked against the database clock. ON DELETE CASCADE removes a deleted
-- account's sessions. No email, IP address or user agent is stored.
CREATE TABLE "AuthSession" (
  "idHash"       TEXT           NOT NULL,
  "userId"       TEXT           NOT NULL,
  "createdAt"    TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "expiresAt"    TIMESTAMPTZ(3) NOT NULL,
  "revokedAt"    TIMESTAMPTZ(3),
  "revokeReason" TEXT,
  CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("idHash"),
  CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AuthSession_idHash_format" CHECK ("idHash" ~ '^[A-Za-z0-9_-]{43}$'),
  CONSTRAINT "AuthSession_expiry_after_creation" CHECK ("expiresAt" > "createdAt"),
  CONSTRAINT "AuthSession_revokeReason_valid" CHECK ("revokeReason" IS NULL OR "revokeReason" IN ('logout', 'logout_all', 'account_deleted', 'admin')),
  CONSTRAINT "AuthSession_revocation_complete" CHECK (("revokedAt" IS NULL) = ("revokeReason" IS NULL))
);

CREATE INDEX "AuthSession_userId_active_idx" ON "AuthSession"("userId") WHERE "revokedAt" IS NULL;
CREATE INDEX "AuthSession_expiresAt_idx" ON "AuthSession"("expiresAt");
