# packages/mcp-tools

The shared core of Aura's MCP tool, `find_best_time`, used by two transports:

| Transport | Where | SDK | Status |
|---|---|---|---|
| Local stdio | `apps/mcp` | `@modelcontextprotocol/sdk` 1.x (pinned in `apps/mcp`) | Merged in AURA-MCP-01 |
| Remote Streamable HTTP | `apps/web/app/api/mcp/route.ts` | `@modelcontextprotocol/server` 2.x (pinned at the repo root) | **Foundation only (AURA-MCP-02-I1).** Off by default, and every request is rejected with 401. |

## Files

| File | Role | May import |
|---|---|---|
| `src/findBestTimeSchema.ts` | Strict zod input schema plus `TIMING_LIMITS` mirror | zod, the shared timezone validator, the activity catalog |
| `src/findBestTime.ts` | `executeFindBestTime`, a thin adapter over `buildTimingSearchRequest` and `runTimingSearchWithDailyRhythm` | shared Timing Search modules only |
| `src/findBestTimeTool.ts` | `FIND_BEST_TIME_TOOL` (name, title, description, annotations, schema) and the shared outcome-to-result mapping | the schema and executor types |
| `src/findBestTimeRemote.ts` | Remote profile: caps an explicit `dateRange` at a **span** of 14 days (`end − start`, the same convention as the local 90-day limit, so up to 15 calendar dates inclusive; D1 threat T9). Otherwise delegates to the executor. | the executor |
| `src/http/remoteMcpHandler.ts` | Framework-free Web `Request` → `Response` handler, protected resource metadata, fail-closed config parsing, client-binding / rate-limit / audit hooks | `@modelcontextprotocol/server`, the files above and `src/security/*` |
| `src/security/rateLimit.ts` | `McpRateLimiter` interface (per-rule limits) plus a bounded in-memory fixed-window limiter (process-local; local/dev only) | nothing |
| `src/security/audit.ts` | Redacted audit events: allowlisted fields only, pseudonymous `userRef` | `crypto` |
| `src/auth/authorizationServer.ts` | OAuth authorization server on `oidc-provider` 9.13.3 (I2a): Node req/res `handle()`, consent interaction, resource-server token verifier | `oidc-provider`, the handler's types, `src/security/*` |
| `src/auth/memoryAdapter.ts` | In-memory `oidc-provider` adapter (local/tests only) | nothing |
| `src/auth/oidc-provider.d.ts` | Narrow local typings for the library subset Aura uses | — |

**Rule:** the four core files must never import an MCP SDK, a database, a session or `process.env`. Both `apps/mcp/test/isolation.test.ts` (compiled graph) and `test/mcpRemoteTransport.test.ts` (source imports) enforce this. Only `apps/web/lib/mcpRemoteConfig.ts` reads the environment.

## Remote endpoint behaviour (I1)

Checks run in this order, failing closed:

1. `AURA_MCP_REMOTE_ENABLED` is not exactly `1`, or `AURA_MCP_RESOURCE_URL` / `AURA_MCP_AUTHORIZATION_SERVER` is missing or invalid: **404 for every HTTP method** on `/api/mcp` and both protected-resource-metadata URLs. Every method is routed through the handler, so Next doesn't answer OPTIONS or PUT itself.
2. A method other than POST returns **405**. The endpoint is stateless (no sessions and no SSE stream).
3. An `Origin` header that is present but not the resource's own origin returns **403**. Requests without an `Origin` header, which is normal for vendor server-to-server calls, are allowed.
4. A declared body over 16 KB returns **413** before authentication runs.
5. A missing or rejected bearer token returns **401** with `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource/api/mcp", scope="aura.planning.read"`, adding `error="invalid_token"` only when a token was presented (RFC 6750 §3.1). A token without the scope returns **403** `insufficient_scope`.
6. The body is read with a streaming 16 KB cap (413 beyond it). Invalid JSON returns 400. A **JSON-RPC batch** (array) returns 400 / `-32600`: batching was removed from the protocol in 2025-06-18, and a batch would multiply the per-request Timing Search cost that the window cap bounds.
7. Otherwise the request is handled as stateless JSON-RPC by a fresh `McpServer` per request.

**Nothing is callable in any deployment.** The route wires `rejectAllAccessTokens` everywhere except the gated local development path below. Personalization from the verified account, which excludes the birth profile per D-2, arrives in MCP-02-I3.

After authentication (I2a): a token without the scope returns **403** `insufficient_scope`; a token issued to a client the resource does not accept returns **403** `unauthorized_client`; a user over the per-user limit (default 60/min), or a client over its much larger ceiling (default 600/min, which must exceed the per-user limit, so one user can never exhaust it), returns **429** with `Retry-After`. The in-memory limiter never evicts an active window and rejects requests that would need a new key once it is full (`limitedBy: "capacity"`), so it fails closed with bounded memory; it is per process, and a shared store is I2b work. Every outcome from step 2 on is reported to the audit sink.

## Local OAuth authorization server (I2a)

`src/auth/authorizationServer.ts` is the D2 option A authorization server: Authorization Code + PKCE (S256 only, required), public clients only, one resource (`/api/mcp`) and one scope (`aura.planning.read`) via RFC 8707, opaque access tokens (default 10 minutes) with no refresh tokens, RFC 7009 revocation, RFC 9207 `iss`, and discovery at both `/.well-known/oauth-authorization-server` and `/.well-known/openid-configuration`. Userinfo, end-session, introspection, registration, PAR, DPoP, device flow and dev interactions are off.

Login reuses the existing Aura session (`as_session`). The consent page is an explicit POST with an HMAC CSRF token bound to the interaction and the user, an Origin check and anti-framing headers.

**Session binding (I2a-R1).** `oidc-provider`'s own login session is never trusted on its own. On every authorization request a login-prompt check confirms that a current Aura session exists and names the same user; otherwise login is required again (`prompt=none` → `login_required`). If the provider session belongs to a different user (sign-out then sign-in, or an account switch), it is destroyed and the request restarts for the current user. Consent is required on every authorization request (`prompt=none` → `consent_required`), so no code is ever issued silently, including to an attacker-chosen PKCE challenge. Only loopback TCP peers can reach the authorization server.

**Where it runs.** Only where `apps/web/lib/mcpAuthGate.ts` returns `local`, which requires all of: not on Vercel (no `VERCEL*` variables, and the Production and staging project ids are pinned as explicit denials), `NODE_ENV=development` or `test` (so never `next build` / `next start`), `AURA_MCP_AUTH_MODE=local-dev`, an `AUTH_SECRET` of at least 32 characters that is not the public development fallback, remote MCP enabled, and loopback resource and issuer URLs on one origin. In production builds the local code is not emitted at all: both routes wrap it in a literal `process.env.NODE_ENV !== 'production'` block that webpack drops, and `next.config.js` excludes the module from file tracing. Everywhere else `/api/mcp` stays reject-all and the OAuth routes (`apps/web/pages/api/oauth/[...oidc].ts`, reached through `next.config.js` rewrites) return 404.

**State is in memory** (`src/auth/memoryAdapter.ts`): codes, grants, tokens and signing keys are per process and lost on restart. The durable Postgres adapter needs a migration and a separately approved ticket.

Local use (synthetic data only; no Vercel variables are involved):

```bash
cd apps/web
AURA_MCP_REMOTE_ENABLED=1 \
AURA_MCP_RESOURCE_URL=http://localhost:3000/api/mcp \
AURA_MCP_AUTHORIZATION_SERVER=http://localhost:3000 \
AURA_MCP_AUTH_MODE=local-dev \
AUTH_SECRET=<any local value of 32+ characters> \
npx next dev -H 127.0.0.1
```

The single registered client is `aura-local-dev-client`, with loopback redirect URIs `http://127.0.0.1:8976/callback` and `http://localhost:8976/callback`.

Failures return a generic 500 and log only the error class name. Arguments, tokens and bodies are never logged.

## Schema snapshot

`fixtures/findBestTimeInputSchema.json` is the canonical JSON Schema of the tool input: keys sorted, without `$schema`, because the dialect URI is SDK-specific (v1 emits draft-07, v2 emits 2020-12, and nothing else differs). Both transports' tests compare their advertised `inputSchema` against it. If you change the schema deliberately, regenerate the snapshot and review the diff.

**Known (pre-existing):** the `activityId` description's example `"exercise"` is not a catalog id. Fixing it changes the advertised schema of the merged stdio tool, so it is deferred to a separately scoped change.

## Dependencies and resolution

Code outside `apps/web` resolves bare imports from the **repository root** `node_modules`. Vercel's install command is `npm install --prefix ../.. && npm install`, and CI installs root dependencies the same way. So `zod`, `@modelcontextprotocol/server` and `oidc-provider` are exact-pinned in the root `package.json`.

`apps/mcp` compiles these same files with its own `zod`, via a `paths` mapping in `apps/mcp/tsconfig.json`. The remote test asserts that the root and `apps/mcp` zod pins are identical.

## Tests

```bash
npm install                                   # repo root
npx ts-node test/mcpRemoteTransport.test.ts   # remote handler (CI: math-core-tests job)
npx ts-node test/mcpOAuthLocal.test.ts        # local OAuth -> MCP, environment gate (CI: math-core-tests job)
npx ts-node test/mcpOAuthSecurityRegression.test.ts  # I2a-R1 security regressions (CI: math-core-tests job)
(cd apps/mcp && npm ci && npm test)           # stdio server plus shared-definition check (CI: MCP Server job)
```
