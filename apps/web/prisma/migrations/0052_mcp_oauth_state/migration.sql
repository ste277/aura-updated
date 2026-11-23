-- AURA-MCP-02-I2b -- durable, shared state for the remote MCP OAuth
-- authorization server. Two NEW tables only: no change to any existing
-- table, no backfill, no foreign key into existing tables (OAuth state is
-- keyed by opaque ids and is safe to drop with the feature).
--
-- "McpOAuthPayload": every oidc-provider model (AuthorizationCode,
-- AccessToken, RefreshToken, Grant, Session, Interaction, ...). The primary
-- key "id" is SHA-256 of the provider id and "payload" is stored WITHOUT its
-- jti, so bearer tokens, codes and session ids are never stored in clear.
-- "consumedAt" is set by ONE conditional UPDATE (single-use codes and
-- refresh tokens; packages/mcp-tools/src/auth/postgresAdapter.ts, F6).
-- "grantId" lets a grant and everything issued under it be revoked with one
-- DELETE; "accountId"/"clientId" power the connected-assistants list.
--
-- "McpRateLimitWindow": fixed-window counters shared by every instance
-- (packages/mcp-tools/src/security/postgresRateLimit.ts, R1-L1 / F5).
--
-- Rows in both tables carry "expiresAt"; expired rows are invisible to reads
-- and removed in bounded batches.
CREATE TABLE "McpOAuthPayload" (
    "model"      TEXT NOT NULL,
    "id"         TEXT NOT NULL,
    "payload"    JSONB NOT NULL,
    "grantId"    TEXT,
    "accountId"  TEXT,
    "clientId"   TEXT,
    "uid"        TEXT,
    "userCode"   TEXT,
    "expiresAt"  TIMESTAMPTZ(3),
    "consumedAt" TIMESTAMPTZ(3),
    "createdAt"  TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "McpOAuthPayload_pkey" PRIMARY KEY ("model", "id")
);

CREATE INDEX "McpOAuthPayload_grantId_idx" ON "McpOAuthPayload"("grantId");
CREATE INDEX "McpOAuthPayload_model_uid_idx" ON "McpOAuthPayload"("model", "uid");
CREATE INDEX "McpOAuthPayload_model_userCode_idx" ON "McpOAuthPayload"("model", "userCode");
CREATE INDEX "McpOAuthPayload_model_accountId_clientId_idx" ON "McpOAuthPayload"("model", "accountId", "clientId");
CREATE INDEX "McpOAuthPayload_expiresAt_idx" ON "McpOAuthPayload"("expiresAt");

CREATE TABLE "McpRateLimitWindow" (
    "key"         TEXT NOT NULL,
    "windowStart" TIMESTAMPTZ(3) NOT NULL,
    "count"       INTEGER NOT NULL DEFAULT 0,
    "expiresAt"   TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "McpRateLimitWindow_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "McpRateLimitWindow_expiresAt_idx" ON "McpRateLimitWindow"("expiresAt");
