-- AURA-AUTH-SESSION-01-I2-R2 (39250, design Rev 4 B3): session-bound MCP
-- consent finalization. One NEW table only: no existing table, row or index
-- changes, no backfill, and no change to the separate MCP OAuth database.
--
-- An MCP OAuth grant is usable only while a row here binds it to its exact
-- account, client and complete authorization. The row is written by ONE
-- conditional statement that requires the approving AuthSession to be live
-- (not revoked, not expired, by the database clock) and holds it FOR SHARE,
-- so it is ordered against logout inside this database. Rows are immutable:
-- never updated (trigger below), inserted with ON CONFLICT DO NOTHING, and
-- deleted only by account deletion (cascade) or expiry cleanup.
--
-- "grantKey" is the hex SHA-256 storage key of the grant id (the raw id is
-- never stored); "authSessionIdHash" records which session approved it (no
-- foreign key: session cleanup deletes old rows). No email, IP address or
-- user agent is stored.
CREATE TABLE "McpConsentFinalization" (
  "grantKey"          TEXT           NOT NULL,
  "userId"            TEXT           NOT NULL,
  "clientId"          TEXT           NOT NULL,
  "authorization"     TEXT           NOT NULL,
  "authSessionIdHash" TEXT           NOT NULL,
  "createdAt"         TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "expiresAt"         TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "McpConsentFinalization_pkey" PRIMARY KEY ("grantKey"),
  CONSTRAINT "McpConsentFinalization_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "McpConsentFinalization_grantKey_format" CHECK ("grantKey" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "McpConsentFinalization_sessionHash_format" CHECK ("authSessionIdHash" ~ '^[A-Za-z0-9_-]{43}$'),
  CONSTRAINT "McpConsentFinalization_clientId_length" CHECK (length("clientId") BETWEEN 1 AND 200),
  CONSTRAINT "McpConsentFinalization_authorization_length" CHECK (length("authorization") BETWEEN 1 AND 4000),
  CONSTRAINT "McpConsentFinalization_expiry_after_creation" CHECK ("expiresAt" > "createdAt")
);

CREATE INDEX "McpConsentFinalization_expiresAt_idx" ON "McpConsentFinalization"("expiresAt");

CREATE FUNCTION "McpConsentFinalization_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'McpConsentFinalization rows are immutable' USING ERRCODE = '23514';
END $$;

CREATE TRIGGER "McpConsentFinalization_no_update"
  BEFORE UPDATE ON "McpConsentFinalization"
  FOR EACH ROW EXECUTE FUNCTION "McpConsentFinalization_immutable"();
