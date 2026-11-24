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
| `src/auth/memoryAdapter.ts` | In-memory `oidc-provider` adapter (local/tests only); same atomic contract as the Postgres adapter | `src/auth/oauthStore.ts` |
| `src/auth/oauthStore.ts` (I2b) | Store contract: atomic single-use `consume`, `ReplayDetectedError`, connections list / disconnect, cleanup | `oidc-provider` errors |
| `src/auth/postgresAdapter.ts` (I2b) | Durable, shared adapter on table `McpOAuthPayload` (migration 0052): conditional-UPDATE consume, SHA-256 ids, no `jti` at rest; I2b-R1: Interaction `session.cookie` dropped, Interaction `returnTo` and Session `state.secret` sealed; I2b-RR-1: Session `state.postLogoutRedirectUri` sealed; I2b-RR-2: an Interaction without its sealed `returnTo` reads as not found | an injected `query` (a `pg` Pool), `fieldSeal.ts` |
| `src/auth/fieldSeal.ts` (I2b-R1) | AES-256-GCM field sealing, keys derived by HKDF from the OAuth cookie keys, AAD bound to row + field, rotation by `kid`, fail closed | `crypto` |
| `src/auth/keys.ts` (I2b) | Signing JWKS / cookie keys / pairwise salt / audit key from env, validation, rotation; ephemeral keys for local/tests | `crypto` |
| `src/auth/clientPolicy.ts` (I2b) | Static client registration policy (https or loopback redirect URIs, labels, refresh permission); no DCR / CIMD | nothing |
| `src/security/postgresRateLimit.ts` (I2b) | Distributed fixed-window limiter on table `McpRateLimitWindow`: all-or-nothing, row-locked, bounded (lock/statement timeouts, decision deadline), fail closed | an injected `pg` Pool |
| `src/security/clientAddress.ts` (I2b) | Client address from the TCP peer or ONE allowlisted trusted-proxy header; never `X-Forwarded-For`. Strict canonical IPv4/IPv6 parser; IPv4 /32 and IPv6 /64 rate-limit buckets | nothing |
| `src/security/preAuthRules.ts` (I2b-S2) | Pre-auth rules: address bucket (or the shared `unresolved` bucket) plus one shard of the global ceiling; shard limits sum to exactly the ceiling | `crypto` |
| `src/security/deadline.ts` (I2b-S2) | `StoreUnavailableError` (503), `withDeadline`, `singleFlight`, shared `pg` pool bounds | nothing |
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

## Production readiness components (I2b)

I2b adds the components a deployed authorization server needs. **Nothing here enables remote MCP:** `apps/web/lib/mcpAuthGate.ts` is unchanged and still rejects every Vercel deployment, the staging project and the Production project, and every production build compiles the OAuth code out (F15). The components run in the local mode and in tests.

| Finding | Resolution |
|---|---|
| F5 pre-auth flooding | Every OAuth endpoint (`preAuth`) and `/api/mcp` (`preAuthRateLimiter`, checked before the token lookup) are throttled per trusted client address plus a global ceiling. |
| F6 atomic codes | `consume` is one conditional `UPDATE … WHERE "consumedAt" IS NULL … RETURNING`; the loser gets `invalid_grant` and the grant is revoked. Covers codes and rotated refresh tokens. |
| R1-L1 per-process limits | `postgresRateLimit.ts`: one row per key, locked in sorted order, shared by every instance; fails closed. |
| R1-L2 client address | `clientAddress.ts`: `socket`, `none`, or `header:x-real-ip` / `header:x-vercel-forwarded-for` only; single-IP values only. |
| I2b-R-2 database timeouts (S2) | Separate store and limiter pools with checkout and query timeouts. Limiter: `SET LOCAL lock_timeout` 1000 ms / `statement_timeout` 1000 ms, a 1250 ms decision deadline that denies and destroys the connection. Store: a 3000 ms deadline per query; any failure is `StoreUnavailableError`. Cleanups are single-flight. Infrastructure failures answer **503** `temporarily_unavailable` (never 429, never a code or token). |
| I2b-R-3 address normalisation (S2) | Canonical parsing (both IPv4-mapped forms → IPv4; zone ids, ports, lists, brackets rejected), IPv4 /32 and IPv6 /64 buckets, `/api/mcp` reads `AURA_MCP_CLIENT_ADDRESS_SOURCE`. A missing or invalid trusted address uses one shared bounded `unresolved` bucket and is audited (`*.address_unresolved`, reason code only) — never global-only. |
| S3-1 / S3-2 store issuance and late writes (S4) | New authorization codes are stored pending and activated only after the response that delivers them succeeded; any error response loses its `Location` and the code is revoked. Each store statement runs in its own transaction with `SET LOCAL statement_timeout` 1500 ms / `lock_timeout` 1000 ms and is committed only if the 3 s deadline has not answered failure, so a failed write cannot land later. |
| Ambiguous activation and interrupted responses (S6) | A code the server decides not to deliver (activation failed or uncertain, such as a lost COMMIT acknowledgement; error response; client disconnected before the response was fully written) is deleted whether pending or already active, with one retry. If every revocation attempt fails after an activation that did commit, the code was still never sent and expires with its 60 s TTL (audited `CodeRevocationFailed`). |
| Consolidated remediation (S8) | (S3-1 residual hold: superseded by S10.) The provider's request origin is pinned to the configured issuer, so Host / X-Forwarded-* never reach discovery, endpoint URLs or redirects (I2b-R-3). Signing keys must declare `alg`, be internally consistent (RSA CRT members, e = 65537, EC point) and pass a sign/verify probe against their public members; secrets need >= 128 bits of estimated entropy and no repeated block (I2b-R-6). Interaction-page store outages answer 503 (S3-3). One `AURA_MCP_CLIENT_ADDRESS_SOURCE` for the AS and `/api/mcp` (S3-4). Address input is length-bounded before parsing (S3-5). Limiter address buckets are keyed HMACs (S3-6) and shard keys name G and N (S3-7). Every MCP transaction sets `SET LOCAL idle_in_transaction_session_timeout` (S3-8). A COMMIT counts only with the `COMMIT` tag (S5; S10: within the one statement deadline). |
| S11 review residuals (S12) | The code-carrying redirect is validated STRUCTURALLY (302/303; exact registered callback origin + path with its registered query parameters; exactly one `code`, the requested `state`, `iss` = issuer, nothing else; the code occurs once) and the finished hand-off must be byte-identical to it. Limiter causes split explicit COMMIT refusal (`commit_failed`), connection loss after COMMIT (`commit_lost`) and deadline ambiguity (`commit_timeout` / `commit_late`); the bounded cause reaches the sanitized audit on the OAuth path and both MCP paths. The aggregate gate's availability floor is anchored to an independent runner control (plain temp-table transactions, fixed K = 4), so a slower limiter cannot lower its own floor. Deadlines use the ORIGINAL request-budget instant and one `>=` comparison, with checks after ROLLBACK and before every retry. New secrets declare their format (`hex:` / `base64:` / `base64url:`, canonical, >= 16 bytes, used verbatim); untagged values are accepted only as retained cookie keys (legacy rule; hex-lexical values earn hex credit only). |
| S10 review remediation (S11) | Every checked-out pg client (store statements, held activations, limiter decisions) carries one guarded 'error' listener from checkout to release: a terminated or idle-timed-out connection is discarded, never crashes the process, and leaks no listener. Authorization codes are issued only in the query response mode (each client's `response_modes: ['query']`; form_post / fragment refused before a code exists; discovery advertises `query`); the finished redirect's status and Location must still carry the code. Database deadlines are absolute monotonic instants checked after checkout, before COMMIT and on the acknowledgement (late acknowledgements are "unknown", never success). Limiter `unavailable` decisions carry a diagnostic `cause` (deadline, commit_unknown, checkout, driver, internal). Secrets: canonical hex / base64 / base64url only for the format estimate (strength = decoded bytes); anything else is legacy (S8 rule). |
| S3-1 closure, secrets, time budget (S10) | Authorization-code activation is a held transaction COMMITTED only after the complete response was handed off; every other outcome (error response, disconnect, partial write, replaced response, crash/freeze, database outage) leaves the code PENDING in the shared database without any further write, so no instance can redeem it. The S8 instance-local hold and background retry are removed. "Issued" means handed off, not received; a lost COMMIT acknowledgement after hand-off is "issued, outcome unknown" (safe either way). Code lookups use `FOR SHARE`, so a racing redemption waits for the activation. Secrets: format-aware strength (hex 4 bits/char, base64/base64url 6 bits/char; `openssl rand -hex 16` and `-base64 24` accepted) on top of the unchanged S8 rule, with repeated-block / run / skew vetoes. One deadline covers checkout + statement + COMMIT; one request budget (`requestBudgetMs`, default 5000 ms) caps all store calls of a request. |
| I2b-1 limiter contention (S2) | The global ceiling is split into up to 16 shard rows chosen at random, with limits summing to **exactly** the ceiling (aggregate never larger). A decision is 4 statements; rows are locked for one statement plus COMMIT, not from the first upsert. |

Other I2b behaviour:
- **Refresh tokens** (`refreshTokens`): only for clients with `allow_refresh`, only with consented `offline_access`. Always rotated; 7-day idle and 30-day absolute lifetime by default; replay revokes the grant.
- **ID tokens** (`idTokens`): off by default (`openid` is stripped). `pairwise` issues only an HMAC `sub` per client.
- **Keyed audit pseudonym:** the audit `userRef` is keyed with `AURA_MCP_AUDIT_KEY`.
- **User flows:** sign-in return at `/connect/sign-in?returnTo=/oauth/interaction/<uid>`, and connected assistants at `/connect/apps` (`GET`/`POST /api/mcp/connections`). Both are disabled wherever the OAuth server is.

### Local use of the durable components

```bash
AURA_MCP_OAUTH_STORE=postgres \
AURA_MCP_OAUTH_DATABASE_URL=postgresql://user@127.0.0.1:5432/aura_local \
...the local OAuth variables above... npx next dev -H 127.0.0.1
```

`AURA_MCP_OAUTH_DATABASE_URL` must be a **loopback** database with migration 0052 applied. `DATABASE_URL` is deliberately never used for OAuth state.

### Deployment requirements (staging; not activated)

`apps/web/lib/mcpRemoteReadiness.ts` checks an environment against this list without enabling anything.

| Requirement | Variable / item |
|---|---|
| Durable store | `AURA_MCP_OAUTH_STORE=postgres`, a database URL, and **migration 0052** applied |
| Trusted client address | `AURA_MCP_CLIENT_ADDRESS_SOURCE=header:x-vercel-forwarded-for` (Vercel) or `header:x-real-ip` (nginx/Docker). **Before relying on it:** verify on staging that the edge overwrites a client-supplied value of that header (I2b-S2 staging condition; not established by code or tests) |
| Timeouts | Confirm the S2 defaults (2 s checkout, 3 s query, 1.25 s limiter decision, 1 s lock) against the target database's p99 latency |
| Signing keys | `AURA_MCP_OAUTH_JWKS`: private RSA ≥ 2048 or EC P-256 JWKs with unique `kid`; first signs |
| Cookie keys | `AURA_MCP_OAUTH_COOKIE_KEYS`: comma-separated, ≥ 32 characters each; first signs |
| Pairwise salt / audit key | `AURA_MCP_OAUTH_PAIRWISE_SALT`, `AURA_MCP_AUDIT_KEY` (≥ 32 characters, all different) |
| Clients | `AURA_MCP_OAUTH_CLIENTS`: JSON array validated by `clientPolicy.ts` |
| Issuer / resource | https, same origin, `AURA_MCP_REMOTE_ENABLED=1` |

**Key rotation:** put the new key first and keep the old one for at least the longest lifetime it protects, then remove it.

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
npx ts-node test/mcpOAuthI2b.test.ts          # I2b offline security tests (CI: math-core-tests job)
DATABASE_URL=<disposable db, migrations applied> npx ts-node test/mcpOAuthPostgresDb.test.ts  # I2b durable store + distributed limiter (CI: Database migration validation job)
DATABASE_URL=<disposable db, migrations applied> npx ts-node test/mcpOAuthStorageProtectionDb.test.ts  # I2b-R1 at-rest protection (CI: Database migration validation job)
(cd apps/mcp && npm ci && npm test)           # stdio server plus shared-definition check (CI: MCP Server job)
```
