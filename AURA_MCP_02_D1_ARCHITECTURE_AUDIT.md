# AURA-MCP-02-D1: Secure AI Assistant Connectivity — Architecture and Security Audit

- **Audit date:** 2026-11-10
- **Repository:** `ste277/aura-updated`
- **Authorization:** read-only audit and local verification only. Nothing was modified, committed, pushed or deployed. No OAuth clients, credentials or Production data were touched.

---

## A. Repository Baseline

| Item | Value |
|---|---|
| `origin/main` SHA | `9a487a93f9380df0ad4d33df731871a67aa2036e` (PANCH-FOLLOWUP-334, #339) |
| AURA-MCP-01 merge | `64fdbd2e4fcfec6790265bcfb065c15f02b609f0`, an ancestor of `main` (verified) |
| MCP package | `apps/mcp/`: `src/index.ts` (stdio entry), `src/server.ts` (`createServer`), `src/schemas/findBestTime.ts`, `src/tools/findBestTime.ts`, 4 test files plus `helpers.ts`, `README.md` |
| MCP SDK | `@modelcontextprotocol/sdk` 1.32.2 (exact pin), zod 4.6.7. The installed SDK ships `server/webStandardStreamableHttp.js` (Web `Request`/`Response` Streamable HTTP transport) and `server/auth/*` helpers. Neither is used today. |
| Web app | Next.js 14.2.35 App Router, `output: 'standalone'`, `experimental.externalDir: true` (already imports `packages/*` across the monorepo). **Runtime data access is raw `pg`** (`apps/web/lib/db.ts:1`, one ~4,150-line module mixing reads and writes; `getUserById` is `SELECT *`, db.ts:1970). Prisma 5.17 is used for migrations only (51 migrations, applied by `vercel-build.sh` in Production only). `apps/web` has **no** zod and no MCP SDK dependency. |
| Timing adapters | `apps/web/lib/timingSearchRequest.ts` (`buildTimingSearchRequest`), `apps/web/lib/timingSearchDailyRhythm.ts` (`runTimingSearchWithDailyRhythm`), `packages/recommendation/src/timingSearch.ts` (`runTimingSearch`) |
| Auth | Hand-rolled HMAC tokens (`apps/web/lib/auth.ts`), cookie `as_session`, magic link plus a 6-digit email code. No OAuth, no JWT library, no identity provider. |
| CI | `.github/workflows/ci.yml` job `mcp-server` (Node 20, `npm ci && npm test` in `apps/mcp`) |

**Tests executed:**
- **What ran:** the AURA-MCP-01 suite, on a clean `git archive` export of `origin/main` (`apps/mcp`, `apps/web/lib`, `packages`) using `npm ci && npm test`.
- **Result:** 39 tests, 39 pass, 0 fail, about 8.0 s.
- **Environment:** run locally on Node v26.5.0. CI pins Node 20, so this local run is supplementary to CI, not a replacement for it.
- **Conclusion:** the foundation is present and functional. Nothing in `apps/mcp` was modified.

**Local latency probe** (same export, warm run, `taskTitle` "Morning run", 45 min, New York):

| Search window | Latency | Candidates | Payload |
|---|---|---|---|
| `horizon: TODAY` | 59 ms | 3 | 2.3 KB |
| 7-day `dateRange` | 584 ms | 3 | 2.7 KB |

Cost scales roughly linearly per day (about 80 ms/day). The engine permits `MAX_DATE_RANGE_DAYS: 90`, which extrapolates to about 7 s of CPU per call. See threat T9.

### Existing tool, end to end (`find_best_time`, stdio)

| Aspect | Behaviour today |
|---|---|
| **Registration** | `server.registerTool('find_best_time', { inputSchema: findBestTimeObjectSchema (.strict), annotations: readOnlyHint true, destructiveHint false, idempotentHint true, openWorldHint false })` |
| **Input** | Exactly one of `activityId` (must be in `FULL_ACTIVITY_CATALOG`) or `taskTitle` (≤200 chars); `durationMinutes` 15–360; one of `horizon` or `dateRange` (≤90 days, real calendar dates); `timePreference`; `limit` 1–10 (integer); `timezone` (IANA, validated); `location {latitude, longitude}` (required); optional `referenceTime` (must carry an offset); optional `dailyRhythm {workStart, workEnd, workDays}` |
| **Output** | `{ personalized:false, personalizationNote, query{…echo…}, mode:'FIND', candidates[ engine TimingCandidate + rank + dailyRhythmNote ], unavailableDayCount?, unavailable? }` in both `structuredContent` and text. No declared `outputSchema`. |
| **Validation** | Two layers: zod (shape and format), then the existing `buildTimingSearchRequest` (identical to the web route) |
| **Timezone** | Caller-supplied IANA zone. `resolveTzOffsetMinutes(tz, reference)` as in the route. Known limitation: the per-day DST offset is taken from the reference instant (`timingSearch.ts:463`; documented in the README). |
| **Location** | Required explicit coordinates. No account lookup. |
| **Duration** | Passed through. Fractional minutes are allowed (documented). |
| **Panchangam** | Entirely inside `runTimingSearch`: Panchang windows, Muhurta, caution overlap (#332/#339), activity fit. The adapter does not score or rank. |
| **Daily Rhythm** | Optional explicit work hours go through `validateDailyRhythmPreferencesInput`, then `runTimingSearchWithDailyRhythm` (soft-prefer plus annotate). This is the same function the web route uses. |
| **User preferences** | None. `personalContext` (birth-profile Tara Bala) is deliberately omitted, and saved preferences are not read. |
| **Errors** | `INVALID_INPUT` (validation message) or `CALCULATION_FAILED` (error class name only, no stack). Returned with MCP `isError: true`. |
| **Data access** | None: no database, no session, no network, no product events |
| **Security boundary** | Local process on stdio. The trust boundary is the user's own machine. |

**Can it resolve authenticated user context?** No. The tool is explicit-input only, by design, and has no notion of identity. That is the correct state for MCP-01, and it is what makes the core reusable.

**Reuse classification:**

| Component | Remote reuse |
|---|---|
| `runTimingSearch`, `runTimingSearchWithDailyRhythm`, `buildTimingSearchRequest`, `validateDailyRhythmPreferencesInput`, `resolveTzOffsetMinutes`, `buildPersonalMuhurtaContextForUser` | **Unchanged** (shared with the web route) |
| `findBestTimeObjectSchema` / `TIMING_LIMITS` | Reuse **with a narrower remote profile**: drop `location`, `timezone` and `dailyRhythm` (they come from the account), and cap `dateRange` lower (T9) |
| `executeFindBestTime` | **New sibling adapter** `executePersonalFindBestTime(args, verifiedContext)`. The stdio adapter stays untouched. |
| `createServer` (stdio) | Unchanged. The remote server gets its own registration with the remote schema, an `outputSchema`, and auth-aware handling. |
| Error envelope / redaction pattern | Reuse |

No timing, Panchangam or ranking logic needs to be duplicated.

---

## B. Platform Compatibility

Every fact below came from live fetches on 2026-11-10. Items marked UNVERIFIED could not be confirmed from an official page.

### Claude Web (claude.ai)

| Requirement | Finding | Source |
|---|---|---|
| Transport | Streamable HTTP recommended. Legacy HTTP+SSE supported but "being deprecated". stdio/local config is not available on claude.ai. | claude.com/docs/connectors/building; support 11175166 |
| Network origin | Claude connects "from Anthropic's cloud infrastructure". The server must be reachable from the public internet. Egress is from `160.79.104.0/21`. The authorization server's discovery endpoints must also be reachable. | support 11175166; claude.com/docs/connectors/building/authentication |
| Plans and registration | Free, Pro, Max, Ultra, Team, Enterprise; Free is limited to one custom connector. Pro/Max: Customize → Connectors → Add custom connector. Team/Enterprise: only Owners/Primary Owners (or a custom role, on Enterprise) add it; each member then connects individually. A connector must be removed and re-added to edit it. | support 11175166 |
| Auth options | `none` (authless), `oauth_dcr` and `oauth_cimd` supported by default; "Use your own OAuth client" allowed for custom connectors; static headers in beta | claude.com auth page; support 11175166 |
| OAuth profile | Follows MCP authorization specs 2025-03-26, 2025-06-18 and 2025-11-25. PKCE S256 on every request. Uses CIMD only when server metadata advertises `client_id_metadata_document_supported: true` **and** `none` in `token_endpoint_auth_methods_supported`; otherwise DCR. Scopes come from `WWW-Authenticate` `scope` or `scopes_supported` (adds `offline_access` if listed). | claude.com auth page |
| Redirect URI | `https://claude.ai/api/mcp/auth_callback` (claude.ai web, Desktop, mobile, Cowork) | claude.com auth page |
| Tokens | Refreshes reactively on 401, and proactively up to 5 minutes before expiry. Refresh failure must return `invalid_grant`. Refresh tokens must rotate for public clients. 10 s budget for discovery/registration/token endpoints; 30 s for refresh. | claude.com auth page |
| Tool approval | Users review approval requests ("Allow always" is available) and can disable individual tools. The review criteria say `readOnlyHint: true` tools "can run without per-call confirmation". That is stated for directory review; custom-connector auto-permission behaviour is not explicitly stated. | support 11175166; review-criteria |
| Limits | Tool result about 150,000 characters; 240 s per tool call; no resource subscriptions or sampling | claude.com building page |
| Tool-change re-surfacing / `listChanged` | **UNVERIFIED** | — |
| CIMD URL used by claude.ai hosted clients | **UNVERIFIED.** Only the Claude Code document (`https://claude.ai/oauth/claude-code-client-metadata`) was found. | claude.com auth page |

### ChatGPT Web

| Requirement | Finding | Source |
|---|---|---|
| Transport | "SSE and streaming HTTP". The endpoint must be public HTTPS (or a Secure MCP Tunnel), typically `/mcp`. | developers.openai.com/api/docs/guides/custom-mcp-server; apps-sdk/deploy/connect-chatgpt |
| Registration | chatgpt.com/plugins → + → "Add custom MCP server" → name, URL, auth → accept the risk warning → "Create as a plugin" → install. Private and workspace-only use goes through this custom-server path. Public listing requires org verification and review ("continuous review" of tool changes). | custom-mcp-server; plugins/deploy/app-review |
| Plans and admin | "Workspace permissions and security restrictions, including Lockdown, apply." **Plan eligibility is UNVERIFIED.** The help-center article returned 403, and the developer-mode guide returned 404 after a redirect. | custom-mcp-server |
| Auth options | OAuth, No authentication, or mixed. "ChatGPT does not support … custom API keys". No machine-to-machine grants. | custom-mcp-server; apps-sdk/build/auth |
| OAuth profile | OAuth 2.1 per the MCP authorization spec. Authorization code with PKCE S256 (server metadata must list S256). Protected Resource Metadata at `/.well-known/oauth-protected-resource` or via `WWW-Authenticate`. AS metadata via RFC 8414 or OIDC. Client registration: CIMD preferred; DCR if `registration_endpoint` is present; static credentials if provided. | apps-sdk/build/auth |
| Resource / audience | Sends `resource=<mcp url>` on authorize and token requests. The token must carry that audience. The server must verify issuer, audience, expiry and scopes. | apps-sdk/build/auth |
| Redirect URI | `https://chatgpt.com/connector_platform_oauth_redirect` if the AS supports RFC 9207 `iss` (`authorization_response_iss_parameter_supported: true`). Otherwise a per-connector `https://chatgpt.com/connector/oauth/{callback_id}`. | apps-sdk/build/auth |
| Client identity | ChatGPT presents an OpenAI-managed mTLS client certificate. Egress IP ranges are published. | apps-sdk/build/auth |
| Tool approval | Write actions require confirmation by default. `readOnlyHint` is respected; tools without it are treated as writes. Approval can be remembered per conversation. Refreshing metadata is manual for custom servers ("Refresh"). | custom-mcp-server |
| Required tools | Custom MCP servers do not require `search`/`fetch`. Those are needed only for company-knowledge eligibility. | custom-mcp-server; mcp-server |
| Output | `structuredContent` (model-visible), `content`, `_meta` (hidden from the model). Outputs should match the declared `outputSchema`. Server `instructions`: keep key details in the first 512 characters. Widgets are optional. | mcp-server; connect-chatgpt |
| Timeouts and size limits | **UNVERIFIED** | — |

### MCP specification 2025-11-25 (authorization and transports)

- **Authorization is optional, and stdio "SHOULD NOT" use it.** Our current server is correctly authless. A remote server that touches user data must implement it.
- **Protected Resource Metadata (RFC 9728):** the server **MUST** implement it.
- **AS metadata:** the authorization server **MUST** provide RFC 8414 or OIDC Discovery metadata.
- **Resource indicators (RFC 8707):** clients **MUST** send `resource`. The server **MUST** validate that the audience is itself.
- **No token passthrough:** the server **MUST NOT** pass through the token it received, nor accept tokens issued for other resources.
- **PKCE S256:** required. Clients refuse to proceed if `code_challenge_methods_supported` is absent.
- **Client registration preference:** pre-registered, then CIMD (SHOULD), then DCR (MAY, for backward compatibility).
- **Redirect URIs:** must be HTTPS or localhost. Tokens never go in query strings.
- **Streamable HTTP:** servers **MUST** validate `Origin` (403 if invalid). Clients send `MCP-Protocol-Version`. `MCP-Session-Id` is optional.

### Client category distinctions

| Category | Example | Reaches Aura how | Applies to |
|---|---|---|---|
| Local desktop MCP client | Claude Desktop/Code with stdio config | Spawns `apps/mcp` locally | MCP-01, done |
| Browser-based assistant | claude.ai, chatgpt.com | **Vendor cloud** calls a public HTTPS endpoint. The browser never talks to Aura's MCP endpoint directly, but it does visit Aura's `/authorize` page. | MCP-02 |
| Hosted MCP connector | Claude custom connector, ChatGPT custom MCP server | The registration object on each vendor's side | MCP-02 |
| Custom app integration | ChatGPT public plugin listing, Claude directory listing | The above plus vendor review and publication | Out of scope for the pilot |

**Conclusion:** stdio support does **not** carry over. Both web clients need a public Streamable HTTP endpoint plus an MCP-conformant OAuth 2.1 authorization server. Both accept CIMD, PKCE S256 and RFC 8707 `resource`, so **one OAuth design can serve both**.

---

## C. Proposed Architecture

```
 claude.ai cloud (160.79.104.0/21)        chatgpt.com cloud (mTLS, published IPs)
            \                                        /
             \  HTTPS  Authorization: Bearer <opaque access token>
              v                                    v
 ┌───────────────────────── apps/web (existing Next.js app on Vercel) ─────────────────────────┐
 │  /.well-known/oauth-protected-resource       (RFC 9728, static JSON)                         │
 │  /.well-known/oauth-authorization-server     (RFC 8414: S256, CIMD, iss param, scopes)       │
 │  /oauth/authorize   ← user's browser; reuses existing Aura sign-in; consent screen            │
 │  /oauth/token       ← code+PKCE exchange, refresh rotation; resource-bound tokens            │
 │  /oauth/revoke      ← RFC 7009                                                                │
 │                                                                                               │
 │  /api/mcp  (POST; Streamable HTTP, stateless, JSON responses)                                 │
 │     1. Origin check · body size cap · rate limit (per token / per user / per IP)             │
 │     2. Bearer → hash lookup → {userId, clientId, scope, audience, exp, revokedAt}             │
 │        401 + WWW-Authenticate resource_metadata=… on any failure                             │
 │     3. McpServer per request (WebStandardStreamableHTTPServerTransport)                       │
 │     4. find_best_time (remote profile)                                                        │
 │          → loadPlanningContext(userId)   ← server-side identity only                         │
 │              column-explicit SELECT → tz, lat/lon, confirmed, dailyRhythm*         │
 │          → executePersonalFindBestTime(args, ctx)                                             │
 │               → buildTimingSearchRequest → runTimingSearchWithDailyRhythm   (UNCHANGED)       │
 │                    → runTimingSearch: Panchang + Muhurta + caution + activity fit            │
 │          → minimized structured response                                                      │
 └───────────────────────────────────────────────────────────────────────────────────────────────┘
                                   │ pg Pool (existing DATABASE_URL)
                                   v
                    Postgres: User (read) · new OAuth tables (grants/tokens, hashed)
```

### Hosting recommendation: inside the existing `apps/web` deployment

- **Identity lives there.** The user table, sign-in flow, `AUTH_SECRET` and `pg` data layer are all in `apps/web`. A separate service would need its own copy of `DATABASE_URL`, a second sign-in path and cross-service token validation. That is more secrets and more attack surface for no benefit.
- **The engine is already imported there.** The timing route imports the same modules today, so ranking parity is guaranteed by construction.
- **Compute fits.** The workload is short, CPU-bound and stateless: about 60–600 ms with the window capped. Vercel Functions on Fluid Compute run the default Node.js runtime with far more headroom than Claude's 240 s tool budget. No long-lived connections are needed.
- **Rejected alternatives:**
  - Separate Vercel project from `apps/mcp`: duplicates DB credentials and auth.
  - Container or daemon: unnecessary operations burden.
  - Exposing the stdio server through a tunnel: prohibited, and has no auth.

### Transport

Use **Streamable HTTP in stateless mode**:
- `WebStandardStreamableHTTPServerTransport` with `sessionIdGenerator: undefined` and `enableJsonResponse: true`.
- Create a fresh `McpServer` per request. Handle POST only; GET and DELETE return 405.

Why stateless:
- Serverless instances share no memory, and the tool has no server-initiated messages.
- Both clients support Streamable HTTP.
- SSE is deprecated, so don't build it.

### New components (proposed only, not built)

1. `apps/web/app/api/mcp/route.ts`: transport and auth gate.
2. A shared remote tool module: the remote schema, `executePersonalFindBestTime` and `outputSchema`. It imports the existing adapters. **Open decision D-4, leaning `packages/mcp-tools` or a module under `apps/web`.** `apps/web` isn't an npm workspace, and `externalDir` imports resolve bare specifiers relative to the importing file. A module in `apps/mcp/src/remote` importing `zod` or the SDK could resolve to `apps/mcp/node_modules`, which isn't installed in the `apps/web` Vercel build, or load duplicate copies. Either way the stdio entry and its 39 tests stay byte-identical.
3. An OAuth 2.1 authorization server (decision D-1, below) with:
   - metadata endpoints,
   - authorize and consent UI,
   - token and revoke endpoints,
   - tables `OAuthGrant`, `OAuthPendingAuthorization`, `OAuthAuthorizationCode` and `OAuthToken`, all storing hashes only. This is an **additive migration** (52nd) through the existing `prisma migrate deploy` path, which `vercel-build.sh` runs in **Production only**.
4. **A dedicated read module** (for example `lib/mcpPlanningContext.ts`) with its own column-explicit `SELECT`. Don't reuse `getUserById` (`SELECT *`), and don't import `db.ts`, which mixes in every writer.
5. "Connected assistants" UI in Settings: list grants, revoke.
6. A shared rate limiter **keyed by token and user**, not IP (see T8). The current `inMemoryRateLimit.ts` is process-local; its header says it is "NOT shared across multiple server instances".
7. New `apps/web` dependencies: `@modelcontextprotocol/sdk` and `zod` 4. There is no existing zod, so no version clash. SDK 1.32.2 also pulls in express, hono, `@hono/node-server`, jose and express-rate-limit. D2 must spike Next 14 bundling (possibly `serverComponentsExternalPackages`) and run a supply-chain audit.

---

## D. Authentication

### Current Aura model (facts)

- **Sessions:** a session is `sign({userId, email, exp: +30 days})`, an HMAC-SHA256 over JSON with `AUTH_SECRET`, stored in the `as_session` cookie.
- **Stateless, with no revocation:** logout only clears the cookie (`api/auth/logout/route.ts`). A stolen session token stays valid for up to 30 days, and nothing server-side can invalidate it.
- **One key for every token kind:** five token kinds share one `sign()` and key, with no `typ` or audience field, and none of their verifiers checks the payload shape. Any signed payload parses as any kind; for example, a session token passes `verifyGuestStateToken` in `request-link/route.ts:66`. The five kinds:
  - magic-link `{email, exp}`,
  - session,
  - `guestState`,
  - Day Constructor preview (`dayConstructorPreviewIntegrity.ts:74`), which has **no `exp`**, so `verify()` accepts it forever,
  - recomposition (`remainingDayRecompositionIntegrity.ts:62`).

  Parameterized queries mean no exploit was found, but the OAuth design must **never accept any `sign()`ed artifact as a bearer**.
- **No auth time in sessions:** session tokens carry `exp` but no `iat`, and magic-link verify always redirects to `/` or `/find?restore=` (`api/auth/verify/route.ts:24-27`). It has no generic return-to.
- **No account deletion:** no account-deletion code path exists today.
- **Email in logs:** `verify-code` logs the email on failure paths (`console.warn('[auth] …', { email })`).

### Recommended flow (both clients)

1. The user adds the connector (URL `https://<aura-host>/api/mcp`) in Claude or ChatGPT.
2. The vendor calls `/api/mcp`, gets a 401 carrying `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource", scope="aura.planning.read"`, then fetches the PRM and the AS metadata.
3. **Client identification is CIMD, so there is no open DCR endpoint.** The `client_id` is an HTTPS URL. Aura fetches the metadata document (SSRF-hardened, cached) and accepts only:
   - an **allowlist of client-metadata hosts** (claude.ai, chatgpt.com) during the pilot,
   - `redirect_uris` exactly matching `https://claude.ai/api/mcp/auth_callback` or `https://chatgpt.com/connector_platform_oauth_redirect`.

   Advertise `token_endpoint_auth_methods_supported: ["none"]` (Claude needs it for CIMD) and `authorization_response_iss_parameter_supported: true`, so ChatGPT uses its stable redirect. **DCR is the fallback only if CIMD proves unworkable in I4**; Claude's hosted CIMD URL is unverified. If needed, implement DCR with the same redirect allowlist.
4. `/oauth/authorize` validates:
   - `response_type=code`, PKCE `S256` (plain is rejected),
   - `resource` must equal the canonical MCP URL,
   - `scope ⊆ {aura.planning.read}`,
   - exact `redirect_uri`.

   **Persist the validated request server-side** (`OAuthPendingAuthorization`: opaque ID, TTL of 10 minutes or less). The user then signs in with the **existing** flow, preferring the **6-digit code**: an emailed magic link opens in the system browser and would lose the pending request, and verify has no return-to.

   The consent screen:
   - names the client, the scope and the data shared (section H);
   - takes its label **only from the allowlisted CIMD or redirect host**, never from the client-supplied `client_name`;
   - says "Only continue if you just clicked Connect in Claude/ChatGPT";
   - is POST with a CSRF token and served with `frame-ancestors 'none'`;
   - requires the user to have **authenticated within the last 15 minutes**, with step-up via an email code if older. This needs an auth time: add `iat` to new session tokens, or derive it as `exp − 30 d`.

   Together these contain the 30-day non-revocable cookie risk (T3) and consent phishing (T15).
5. `/oauth/token` issues:
   - an **opaque access token**: 256-bit random, about 1 h TTL, SHA-256 hash stored, bound to `{userId, clientId, scope, resource}`;
   - a **rotating refresh token**: about 30 days idle, absolute limit about 90 days, reuse detection revokes the whole grant.

   Return `invalid_grant` on refresh failure (Claude requirement) and accept `x-www-form-urlencoded`.
6. `/api/mcp` resolves each bearer with a DB hash lookup. It checks that the token is unexpired, not revoked, `resource ===` the **single pinned canonical URL** and the scope includes `aura.planning.read`. Pin one canonical host: a `vercel.app` alias and the custom domain would otherwise fail RFC 8707 equality. Serve PRM at both `/.well-known/oauth-protected-resource` and the path-suffixed `/.well-known/oauth-protected-resource/api/mcp` (RFC 9728 path insertion). **The `userId` comes only from the token row.** It **never accepts** the `as_session` cookie, an Aura session token, or any token not minted by this AS. It never forwards the bearer anywhere.

**Why opaque DB tokens rather than JWTs:** they are revocable immediately, there's no new signing-key management, and the lookup cost is negligible at pilot scale. The `auth.ts` `sign()` primitive and `AUTH_SECRET` must **not** be reused for OAuth tokens, because it would invite cross-kind token confusion (T4).

### Identity mapping

`OAuthGrant(userId → User.id, clientId, scope, createdAt, lastUsedAt, revokedAt)`. One grant per (user, client). Tool inputs contain **no** `userId` or email field at all; the strict schema rejects unknown keys.

### Account switching

If the user re-authorizes as a different Aura account, the vendor gets a new grant and the old grant's tokens stay bound to the old user. Neither can reach the other's data. The consent screen shows the signed-in email and offers "Not you? Sign out" first.

### Revocation and invalidation

- **Sources:** the Settings "Connected assistants" page (revoke a grant, which revokes all its tokens), RFC 7009 `/oauth/revoke`, and an admin kill switch (section I).
- **Account deletion:** the FKs get `ON DELETE CASCADE` for when deletion exists. No deletion path exists today, so it is not a current revocation source.
- **Logout scope:** today's logout does not touch OAuth grants, and that's intended. Disconnecting an assistant is a separate action.
- **Open decision D-5:** should "sign out everywhere" also revoke grants?

### Security gaps (must close before launch)

| ID | Gap | Severity |
|---|---|---|
| G1 | No OAuth AS exists. Build-vs-adopt decision pending (D-1). | P0 (blocking) |
| G2 | Session tokens are non-revocable for 30 days, so cookie theft could authorize a connector | P1 (mitigated by step-up at consent) |
| G3 | Rate limiter is process-local | P1 |
| G4 | No isolated, publicly reachable staging environment. Preview is behind Vercel SSO (unreachable by vendor clouds). **Preview must be presumed to share the Production DB:** DEPLOY.md:128-137 records `vercel env ls` showing `DATABASE_URL` configured identically for Preview and Production, while `AUTH_SECRET` differs. Separately, migrations don't run outside Production, so the OAuth tables wouldn't exist in Preview. | **P0, blocks I2 staging tests and I4** |
| G5 | Shared HMAC key and untyped payloads across five token kinds, one with no expiry (pre-existing) | P2 (separate hardening ticket) |
| G7 | `pg.Pool` in serverless functions can exhaust Postgres connections without a pooler (DEPLOY.md:5-10). MCP adds DB round-trips per call. | P2 (confirm the pooled Neon URL in D2) |
| G6 | Email logged on auth failures (pre-existing) | P3 |

---

## E. Personal Planning Context

| Data | Existing source | Auth today | Owner | Safe for MCP? | First release? |
|---|---|---|---|---|---|
| Timezone | `User.timezone` (dedicated column-explicit SELECT) | session | user | Yes. Needed for correct times. | **Yes** |
| Location | `User.latitude/longitude/cityName`; `User.locationConfirmedAt` | session | user | Use coordinates **server-side only**. Return `cityName` and confirmed status, not raw coordinates. | **Yes**, qualified when `locationConfirmedAt` is NULL ("Recommendations use your unconfirmed default location; confirm it in Aura Settings") |
| Daily Rhythm (work hours/days) | `User.dailyRhythmWorkStart/End/Days`; `/api/users/daily-rhythm-preferences` | session | user | Yes (soft preference, used identically to Find a Time) | **Yes**. This is what "considering my work schedule" maps to. |
| Activity / duration | Tool input, validated against `FULL_ACTIVITY_CATALOG` | — | — | Yes | **Yes** |
| Birth profile (Tara Bala personal fit) | `buildPersonalMuhurtaContextForUser(user)` (natalContext.ts) | session | user, sensitive | Birth inputs (`janmaNakshatra`/`janmaRashi`) never appear in `TimingCandidate`. **Outputs still leak birth-derived facts when `personalContext` is set:** `reasons[]` with `factor:'PERSONAL'` (`PERSONAL_TARA_SUPPORT/CAUTION`, `value` = Tara name, auraFitEngine.ts:270). Because the day's nakshatra is public, the Tara name narrows the natal nakshatra to 3 of 27. `ELEMENT_AFFINITY` carries the birth `moonElement`, and `auraFitScore`/`score`/rank shift indirectly. | **No (D-2).** In v1, never pass `personalContext`. Stripping fields after the fact is insufficient because scores also shift. A later opt-in scope `aura.birth_profile.read` needs explicit disclosure. |
| Existing plans and commitments | `PlannedActivity`; Day Constructor `loadDecisionSchedulingContext` → `excludedIntervals` | session | user | Only as **exclusion intervals** (never titles or notes) | **No.** Find a Time in the UI does not use them either (section G). Candidate for I3b. |
| Availability periods | `UserAvailabilityPeriod` (`/api/users/availability-preferences`) | session | user | Possible later | No. Not used by Find a Time. |
| Goals, habits, reflections, saved people, captures, reminders | various | session | user | **Not needed** | **Never** in this phase |
| Email, user id | `User` | — | user | Must **not** appear in tool output | Never |

**Data-access boundary:**
- `loadPlanningContext(userId)` is the only user-data read on the MCP tool path. It is in a dedicated module that doesn't import `db.ts`.
- It runs one column-explicit `pg` query: `SELECT timezone, latitude, longitude, "cityName", "locationConfirmedAt", "dailyRhythmWorkStart", "dailyRhythmWorkEnd", "dailyRhythmWorkDays" FROM "User" WHERE id = $1`. That is not the full user row.
- Optionally, the tool path uses a SELECT-only DB role. Decide whether `/api/mcp` writes the token's `lastUsedAt` at all.
- The `userId` comes from the verified token.
- The tool has no other DB access.

**Missing context:**
- If the account's location is unconfirmed or Daily Rhythm is unconfigured, still return a recommendation, but with an explicit `contextQualifications[]` entry.
- Never invent work hours.
- If a requested window is entirely unavailable, return the engine's `unavailable` facts rather than fabricating times.

---

## F. Tool Contract (remote profile)

**One tool is sufficient.**
- "Best time tomorrow" maps to `horizon: TOMORROW`.
- "Outside work hours" is handled by Daily Rhythm (applied from the account) plus `timePreference`.
- "Compare available times" is handled by `limit` (the ranked alternatives).
- "Explain why" is answered from each candidate's engine `reasons`, `label` and caution, plus `dailyRhythmNote`, which the assistant narrates.

No second tool has a demonstrated need. `explain_recommendation` would only re-run the same search.

### Input (strict; no identity fields)

```jsonc
{
  "activityId"?: string,          // XOR taskTitle; catalog-validated
  "taskTitle"?: string,           // ≤200 chars; treated as untrusted data, never instructions
  "durationMinutes": number,      // 15–360
  "horizon"?: "NOW" | "TODAY" | "TOMORROW" | "WEEKEND" | "SEVEN_DAYS",   // XOR dateRange; CUSTOM excluded (as MCP-01)
  // timePreference enum: ANY | MORNING | AFTERNOON | EVENING | NIGHT (verified, timingSearchRequest.ts)
  "dateRange"?: { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" },  // remote cap: ≤14 days (vs 90 locally)
  "timePreference"?: existing enum,
  "limit"?: integer 1–5
}
```

The following are **removed** versus stdio, because they come from the verified account: `location`, `timezone`, `dailyRhythm` and `referenceTime` (the server clock is authoritative). Open question: whether to allow a "travelling" location override later (D-3).

### Output (declared `outputSchema`; `structuredContent` and text summary)

```jsonc
{
  "personalized": true,
  "context": {
    "timezone": "America/New_York",
    "location": { "cityName": "New York", "confirmed": true },   // no raw coordinates
    "dailyRhythmApplied": true,
    "birthProfileApplied": false,
    "existingPlansConsidered": false,
    "referenceTime": "…ISO…"
  },
  "query": { "activityId"|"taskTitle", "durationMinutes", "timePreference", "searchWindow", "limit" },
  "candidates": [
    { "rank": 1, "start": "…", "end": "…", "score": n, "label": "…|CAUTION",
      "reasons": [ …engine structured reasons, passed through… ],
      "dailyRhythmNote"?: "…" }
  ],
  "unavailableDayCount"?: n, "unavailable"?: […],
  "contextQualifications": [ "Location not yet confirmed in Aura", "Existing plans in your Aura calendar were not checked" ]
}
```

- Candidate fields come from the engine. Nothing is invented. Use an **explicit field allowlist** over `TimingCandidate` (start, end, score, label, muhurtaScore, auraFitScore, reasons, conflicts, metadata; timingSearch.ts:197-229).
  - **Pass:** rank, start, end, score, label, muhurtaScore, reasons (minus any `factor:'PERSONAL'`, which is defensive given v1 passes no `personalContext`), and dailyRhythmNote.
  - **Review in I3:** `auraFitScore`, `conflicts` and `metadata`, with a decision per field.

### Read-only guarantees

- The single tool is annotated `readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: false`.
- The remote tool module does not import `db.ts`. A module-level import-graph check against `db.ts` is useless, because importing any reader pulls in every writer. That is why the tool uses the dedicated read module.
- Tests enforce this:
  - a static check that the tool module's import graph excludes `db.ts`, `productEvents` and writer modules;
  - a runtime spy on `pool.query` asserting the tool path issues only `SELECT` statements;
  - optionally, a SELECT-only DB role.
- The OAuth scope `aura.planning.read` is the only scope the AS can issue. A write scope cannot be minted until a future, separately authorized phase.
- Product-event recording is excluded from the MCP path (D-6).

### Errors

These map onto the MCP layer the same way as MCP-01:

| Condition | Response |
|---|---|
| Invalid input | `INVALID_INPUT` |
| Engine failure | `CALCULATION_FAILED` (class name only) |
| Missing context the engine can't proceed without | `CONTEXT_UNAVAILABLE` (e.g. "set your location in Aura") |
| Throttled | `RATE_LIMITED` |
| Bad, expired or revoked token | HTTP 401 with `WWW-Authenticate`; never a tool-level message that reveals whether an account exists |
| Wrong scope | 403 `insufficient_scope` |

---

## G. Ranking Consistency

| Surface | Entry point | Context it uses | Remote MCP (proposed) |
|---|---|---|---|
| **Find a Time** (UI) | `POST /api/timing-search` → `buildTimingSearchRequest` → `runTimingSearchWithDailyRhythm` | user lat/lon/tz, `personalContext` (birth), Daily Rhythm; **no** plans, **no** availability | Same functions. Differences: **no `personalContext`** unless D-2 opts in; server clock instead of `clientNow` (≤12 h skew allowed in the UI) |
| **Plan My Day** (Day Constructor) | `dayConstructorOrchestrator` → `runTimingSearch` with `searchWindow` plus `excludedIntervals` (blocked plans and commitments) and multi-intent placement | availability, plans, goals | **Not replicated.** Remote MCP answers single-activity questions like Find a Time. A recommendation can overlap an existing Aura plan; this is disclosed via `existingPlansConsidered:false`. |
| **Daily Rhythm** | `runTimingSearchWithDailyRhythm` (widen, soft-prefer, annotate) | user work hours | Identical function and inputs |
| **Panchangam overlap / caution** | inside `runTimingSearch` (#332/#339) | — | Identical (unmodified engine) |
| **User constraints** | `timePreference`, `durationMinutes`, window | — | Identical; the window cap is lower (14 days) |

**Conclusion:**
- Remote results will match the Find a Time UI for users with **no birth profile**.
- Users with a birth profile get Tara Bala personal fit in the UI but not via MCP, unless D-2 opts in. This difference must be disclosed in `context.birthProfileApplied` and in the tool description.
- Panchangam's weight is unchanged, because the engine is untouched. Nothing here proposes weakening it.
- **DST:** the engine takes each day's offset from the reference instant (timingSearch.ts:~463). A 7–14-day window that crosses a DST change returns times off by one hour on post-change days. The web route behaves the same, so parity holds, but remote multi-day use widens the exposure. Disclose it in the tool description and track an engine fix as a separately authorized ticket. The parity suite must include a case that crosses a DST change.
- Parity test (I3): for a seeded user, the remote tool's candidates must equal `runTimingSearchWithDailyRhythm` called the way the web route calls it (with `personalContext` set to match the D-2 decision).

---

## H. Security and Privacy

### Threat model

Severity is the pre-mitigation risk to the pilot.

| # | Threat | Sev | Attack scenario | Existing mitigation | Required mitigation | Verification test |
|---|---|---|---|---|---|---|
| T1 | Unauthorized account access | **P0** | Call `/api/mcp` with no token, a forged token or a session cookie | None (no endpoint) | Bearer-only. DB-hashed opaque tokens. 401 + PRM on any failure. Reject the `as_session` cookie. | No token → 401; random token → 401; valid Aura session cookie only → 401 |
| T2 | Cross-user data leakage | **P0** | Client passes `userId`/email, or a token for A is used to reach B's data | Strict schema rejects unknown keys (MCP-01) | Identity only from the token row. No identity fields in the schema. Narrow `select` by the token's `userId`. | Two seeded users: A's token always returns A's context; injected `userId: B` → INVALID_INPUT; output contains no email or id |
| T3 | Token theft and replay | P1 | Leaked access or refresh token reused; stolen 30-day session cookie used to authorize a new grant | HMAC session, `httpOnly` cookie | 1 h access TTL. Rotating refresh with reuse detection (revokes the grant). Revocation UI. Step-up re-auth (≤15 min) at consent. | Replay of a rotated refresh token → `invalid_grant` and the grant is revoked; consent with a 20-minute-old session → step-up required |
| T4 | Incorrect token audience / confusion | **P0** | A token minted for another resource, or any Aura `sign()`ed artifact, presented as a bearer | — | RFC 8707 `resource` bound at issue and checked against one pinned canonical URL. Separate token store; never `auth.ts sign()`/`verify()`. | Mismatched `resource` → 401; the alias host as `resource` → 401; **each of the five `sign()` kinds** (session, magic-link, guestState, DC preview, recomposition) as bearer → 401 |
| T5 | OAuth redirect abuse | **P0** | Malicious `redirect_uri`, or a CIMD document from an attacker domain, to steal codes | — | Exact-match redirect allowlist. CIMD host allowlist. PKCE S256 required. `state` passthrough. RFC 9207 `iss` in responses. Single-use codes with ≤60 s TTL. CIMD fetch SSRF guard (HTTPS only, no private IPs, size and time limits). | Unlisted redirect → error page, no redirect; `plain` PKCE → rejected; code reuse → `invalid_grant`; CIMD at `http://169.254.169.254` → rejected |
| T6 | Prompt injection via inputs or outputs | P2 | `taskTitle` contains instructions; engine reasons echo it to the model | Engine treats `taskTitle` as data. Read-only tool. | Never interpret `taskTitle` server-side. Echo it only in `query`. No free text from other users ever. No write tools, so injection can't escalate to actions. | Fuzz `taskTitle` with injection strings: output is identical apart from the echoed title |
| T7 | Excessive personal-data exposure | P1 | Tool returns full profile, coordinates, birth-derived reasons or scores, plan titles | MCP-01 has no data | Column-explicit SELECT; city name not coordinates; **no `personalContext` in v1** (D-2); no plan titles; explicit output allowlist | Snapshot test of the output allowlist. For a seeded user **with** a birth profile: zero `factor:'PERSONAL'` reasons, and candidates (`score`/`auraFitScore`/order) identical to a run without `personalContext`. |
| T8 | Unbounded tool calls | P1 | An assistant loop calls the tool thousands of times | — | Per-token and per-user limits (e.g. 30/min, 500/day) in a shared store; `limit` ≤5. **Do not key `/api/mcp` limits on IP:** all Claude traffic comes from 160.79.104.0/21 and ChatGPT's from its published ranges, so an IP limit throttles every user of a vendor together. | N+1 calls for one user → `RATE_LIMITED`, while a second user via the same vendor IP is unaffected |
| T9 | Denial of service | P1 | 90-day `dateRange` calls (~7 s CPU each, measured extrapolation); unauthenticated floods | In-memory limiter only on guest routes | Remote window ≤14 days; body cap 16 KB; auth rejected before any engine work; IP or WAF limits **only** on browser-facing `/oauth/authorize` and consent, and on unauthenticated-401 floods, with thresholds sized for vendor egress (or vendor ranges allowlisted) | 15-day range → INVALID_INPUT; unauthenticated burst → 429 (staging) |
| T10 | Sensitive information in logs | P1 (`taskTitle` may be personal; auth routes already log email) | Bearer tokens, `taskTitle`, emails or coordinates written to logs | MCP-01 logs only the error kind; auth routes log email (G6) | Log `{kind, latencyMs, clientId, hashedUserId}` only. Never the Authorization header or tool arguments. Redact query strings on `/oauth/*`. | Log-capture test asserts no token, email or `taskTitle` substring |
| T11 | Compromised or malicious MCP client | P2 | A non-Claude/ChatGPT client registers, or a vendor-side compromise | — | CIMD host allowlist in the pilot. Grants show client identity. Per-grant revocation. Read-only scope limits blast radius. Global kill switch. | Unknown CIMD host → `invalid_client` |
| T12 | Unauthorized write operations | **P0** | Tool or route reaches plan or preference writers | MCP-01 has none | Single read scope. No write tools. Tool-module import-graph excludes db.ts and writers; `pool.query` SELECT-only spy. | Static import test; runtime mutation spy = 0 |
| T13 | Misconfigured public endpoints | P1 | Endpoint live in Production before review; Preview SSO bypass enabled broadly; staging pointing at the Production DB | Preview behind SSO | Feature flag (env) defaulting **off**. Isolated staging project with its own DB (G4). No Production OAuth client until I5 approval. `Origin` validation. | Flag off → `/api/mcp` and `/.well-known/*` return 404; staging `DATABASE_URL` ≠ Production verified by host comparison |
| T14 | Tool schema or permission changes without user awareness | P2 | A server update adds a write tool or widens output; Claude re-surfacing is unverified | — | Version the tool contract. Changes to tools or scopes require a new ticket and review. A new scope forces re-consent. Contract snapshot test in CI. | Snapshot test of `tools/list` fails on any change |
| T15 | Consent phishing / authorization-request forwarding *(added by review)* | P1 | Attacker starts Connect in their own Claude or ChatGPT account and sends the `/oauth/authorize` URL to a signed-in victim, who approves. The code lands at the shared vendor callback, bound to the attacker's vendor session. | — | Pending-request TTL ≤10 min; step-up re-auth; consent copy ("only continue if you just clicked Connect"); grant visibility and revocation; blast radius is read-only city, timezone and work hours | Expired pending request → error; consent page shows the step-up prompt and warning copy |
| T16 | Consent-page CSRF and clickjacking *(added)* | P1 | Auto-submitted or framed consent | `as_session` is SameSite=Lax | POST plus CSRF token; `frame-ancestors 'none'` / `X-Frame-Options: DENY` | Cross-site POST without token → 403; framing blocked |
| T17 | Client-label spoofing via DCR `client_name` *(added)* | P2 | Fallback DCR registers "Claude" with an attacker redirect | — | Label only from the allowlisted host; DCR, if ever enabled, keeps the same redirect allowlist | DCR with an unlisted redirect → rejected |
| T18 | Supply chain from the new SDK dependency tree *(added)* | P2 | Compromised transitive package (express, hono, jose…) | Exact pins in `apps/mcp` | Exact pins plus lockfile in `apps/web`; audit in D2 | `npm audit` / license check recorded |
| T19 | Missing Origin wrongly rejected, or invalid Origin accepted *(added)* | P3 | Vendor server-to-server calls send no Origin | — | Reject **only if Origin is present and not allowlisted** | No-Origin → 200; `Origin: https://evil.example` → 403 |

**P0/P1 launch blockers:**
- **Must be designed and tested before any public endpoint:** T1, T2, T4, T5, T12.
- **Must be closed before the pilot:** T3, T7, T8, T9, T10, T13, T15, T16.
- **Design decisions blocking implementation:** D-1 (AS approach), G4/D-7 (isolated staging project and DB, which blocks I2 staging tests and I4), D-2 (birth profile) and D-4 (module location and dependency resolution, which affects I1).

### Privacy and consent

The consent screen must state, in plain language:

1. **Who:** "Claude (Anthropic)" or "ChatGPT (OpenAI)", taken from the verified client allowlist.
2. **What it can do:** "Ask Aura for recommended times. It cannot create, change or delete plans, preferences or reminders."
3. **What is shared per request:** the activity you ask about, your timezone, your city (and whether it's confirmed), your work-hours preference, and Aura's recommended times with Panchangam reasons.
4. **What is not shared:** your email, birth details, goals, habits, reflections, saved people, and existing plans.
5. **Retention:** once results reach the assistant, **the AI provider's retention policy applies**. Aura stores only the grant, the token hashes, and minimal usage metadata (time, success or failure). It does **not** store recommendation results (D-6).
6. **Revocation:** Settings → Connected assistants → Disconnect, which takes effect immediately. Removing the connector in Claude or ChatGPT does not by itself revoke Aura's grant; revoke in Aura too.
7. **Account deletion:** Aura has no account-deletion path today, so the consent copy must not promise deletion behaviour. The schema cascades grants and tokens for when deletion is built.

There's no new data collection in D1. I2 adds only OAuth grant and token rows, which are needed for revocation.

---

## I. Deployment

### Hosting options

| Option | Verdict |
|---|---|
| **A. Route inside `apps/web` on the existing Vercel project, behind a default-off flag** | **Recommended.** Smallest change, shared identity and engine, Fluid Compute Node runtime. |
| B. Separate Vercel project serving `apps/mcp` over HTTP | Rejected: duplicates DB credentials and sign-in, and validates tokens across services |
| C. Container or daemon | Rejected: unnecessary operations |
| D. Tunnel to local stdio | Prohibited |

### Operational considerations

- **Public reachability:**
  - Vercel Deployment Protection (SSO) blocks the vendor clouds.
  - Required: a **dedicated staging Vercel project** with its **own Postgres**, its own `AUTH_SECRET`, protection disabled only for `/api/mcp`, `/.well-known/*` and `/oauth/*`, and a custom staging domain. Migrations would also need to run there; `vercel-build.sh` currently migrates only when `VERCEL_ENV=production`, so this needs a staging-specific mechanism.
  - **Rejected: a Preview path bypass.** DEPLOY.md:128-137 indicates Preview shares the Production `DATABASE_URL` (G4), so Preview must not be exposed or used for OAuth state. **D-7 is decided by this evidence unless DB isolation is proven.**
- **Secrets:**
  - No new signing secret is needed (opaque tokens).
  - Token hashing uses SHA-256 (high-entropy tokens don't need a pepper; optionally add a pepper env var).
  - Kill switch: `AURA_MCP_REMOTE_ENABLED`, unset meaning off.
  - Nothing is created in D1.
- **Timeouts:** about 60–600 ms per call with the 14-day cap. That is far below Claude's 240 s tool limit and Vercel's function limit. OAuth endpoints are DB lookups, well within Claude's 10 s and 30 s budgets.
- **Observability:**
  - Structured log line per call (T10 fields).
  - Counters: auth failures by reason, rate-limit hits, `CALCULATION_FAILED`.
  - Optional Vercel custom metrics.
  - Alert on a spike in 401s or 429s.
- **Cost:**
  - About 0.1–0.6 s CPU per call. A 50-user pilot at about 20 calls per user per day is about 1,000 calls/day, around 10 CPU-minutes/day. That's negligible on Fluid Compute.
  - The DB adds one token lookup plus one narrow user select per call.
  - WAF rate-limit rules may depend on the Vercel plan (verify in I1).
- **Availability:** the endpoint inherits the app's availability. Failures degrade to a tool error, and the assistant can fall back to "open Aura".
- **Rollback and disablement, in escalating order:**
  1. Flag off, which makes `/api/mcp` and the OAuth endpoints 404 within one redeploy, or immediately via an env-change redeploy.
  2. Bulk-revoke grants (one SQL update).
  3. Instant rollback to the previous Vercel deployment.
  4. The OAuth tables are additive, so leaving them in place is harmless.

---

## J. Proposed Implementation Phases

These are proposals only. Each needs its own authorization.

| Phase | Scope | Depends on | Acceptance gate |
|---|---|---|---|
| **MCP-02-D2: Auth and environment decisions** | Resolve:<br>• D-1 (build the AS in-app with a vetted library vs. adopt a managed provider)<br>• D-2 (birth profile)<br>• D-4 (module location; local spike of Next 14 bundling the SDK, with no deploy)<br>• the staging topology plan (separate project and DB; staging migration mechanism)<br>• the pooled Neon URL (G7)<br>• a dependency supply-chain audit<br>• a desk check of CIMD/DCR behaviour against vendor docs | D1 approval | Written decision record; staging plan approved; no environments, credentials or OAuth clients created without separate authorization |
| **MCP-02-I1: Remote transport foundation** | `/api/mcp` stateless Streamable HTTP; shared remote tool module; **non-personalized** `find_best_time` (explicit location as today) behind a default-off flag; Origin check, body cap, 14-day cap, `outputSchema`. **Auth gate stubbed to 401-always** (except under local tests), so nothing is publicly callable. | D2 | Local MCP Inspector discovery and call; parity with the stdio tool; flag-off 404 test; existing 39 tests unchanged |
| **MCP-02-I2: Authorization server and user isolation** | PRM (both URL forms) and AS metadata, persisted pending authorizations, authorize, consent with step-up/CSRF/framing protection, token and revoke, CIMD allowlist, rotating refresh, additive migration, Connected-assistants UI | I1, D-1, **isolated staging project and DB (G4)** | Full auth test matrix (ticket section 14 plus T15–T19) green locally and in isolated staging; migration reviewed; no Production deploy of the flag |
| **MCP-02-I3: Personalized planning tool** | `loadPlanningContext` (narrow select), remote schema without location/tz, context qualifications, field-allowlist stripping, rate limiter, logging redaction | I2 | Two-user isolation tests; ranking parity vs. the web route; output allowlist snapshot; T7–T10 tests |
| **MCP-02-I4: Claude/ChatGPT compatibility verification** | Register the staging connector in claude.ai (Pro) and ChatGPT (custom MCP server); discovery, read-only invocation, disconnect and reconnect, account switch, token expiry and refresh | I3 + isolated staging (G4/D-7) | Recorded evidence per client; resolves the UNVERIFIED items (Claude CIMD URL, re-surfacing, ChatGPT plan eligibility and limits) |
| **MCP-02-I5: Controlled pilot** | Production flag on for an allowlisted set of users; monitoring; kill-switch drill | I4, separate Production authorization | Pilot plan, consent copy and rollback drill approved |

**Testing strategy:**
- Functional, auth and operational tests run locally and in CI (node:test plus route-handler tests with seeded Postgres).
- Integration tests (Claude and ChatGPT discovery and invocation, disconnect and reconnect) require the **isolated staging environment**. Live connector tests were not run in D1.

---

## K. Independent Review

**Reviewer:** an independent subagent with read-only access, reviewing against `origin/main` `9a487a9`. It did not author this document.

**Reviewer verdict:** CHANGES REQUESTED (targeted; the architecture itself stands). All requested corrections have been applied to this document. Several were spot-checked by the author against `origin/main`:
- `db.ts:1` imports `pg`;
- `getUserById` is `SELECT *`;
- the DEPLOY.md:128-137 wording;
- `PERSONAL_TARA_*` reasons at auraFitEngine.ts:270.

**Verified correct by the reviewer:**
- the auth, session and logout facts;
- the timing-route context (no plans or `excludedIntervals`), while Day Constructor does use `excludedIntervals`;
- the horizon and timePreference enums;
- the SDK and zod pins;
- the rate limiter being process-local;
- the MCP-01 characterization (39 tests: 4+12+10+13);
- the DST note.

| ID | Sev | Finding | Disposition |
|---|---|---|---|
| F1 | P1 | The birth leak is via `factor:'PERSONAL'` reasons (Tara name narrows the natal nakshatra to 3/27), `moonElement` and scores, not `janma*` fields. The proposed test would pass without catching anything. | Fixed: v1 passes no `personalContext`; T7 test rewritten (sections E, F, H) |
| F2 | P1 | Runtime DB is raw `pg` in a mixed read/write `db.ts`, so the Prisma spy and module import-graph checks would not work | Fixed: dedicated read module, column-explicit SELECT, `pool.query` SELECT-only spy, optional SELECT-only role |
| F3 | P2 | "First schema change" is false (51 migrations exist) | Fixed |
| F4 | P1 | DEPLOY.md shows identical Preview/Production `DATABASE_URL`, so G4 blocks I2 as well as I4 | Fixed: G4 is P0 for I2 and I4; Preview bypass rejected |
| F5 | P2 | No zod in `apps/web`; the real D-4 risk is bare-specifier resolution under `externalDir`; SDK pulls express, hono and jose | Fixed: D-4 leans `packages/mcp-tools`; bundling spike plus supply-chain audit in D2 |
| F6 | P2 | IP-keyed limits on `/api/mcp` would throttle all users of a vendor together | Fixed: token and user keying; IP only on browser-facing OAuth pages |
| F7 | P1 | Missing threats: consent phishing, consent CSRF and clickjacking, DCR label spoofing, supply chain, canonical-URL drift | Fixed: T15–T18 added; canonical URL pinned in D step 6 |
| F8 | P2 | Token confusion spans five `sign()` kinds; the DC preview token never expires | Fixed in D; T4 test covers all five; G5 kept at P2 as a separate ticket |
| F9 | P2 | Magic-link return path loses pending OAuth; step-up needs an auth time | Fixed: persisted pending authorization, prefer the 6-digit code, `iat` |
| F10 | P3 | No account-deletion path exists | Fixed: removed as a revocation source and from consent promises |
| F11 | P3 | Origin check must allow a missing header | Fixed: T19 |
| F12 | P3 | Serve the path-suffixed PRM URL too | Fixed: D step 6 |
| F13 | P2 | DST offset bug matters more for multi-day remote windows | Fixed: disclosed in G; DST parity case; engine fix to be ticketed separately |
| F14 | P3 | `pg.Pool` connection exhaustion on serverless | Fixed: G7, confirm the pooled URL in D2 |
| F15 | P3 | Output contract omits muhurtaScore, auraFitScore, conflicts, metadata | Fixed: explicit allowlist in F |
| F16 | P3 | `horizon` values; keep CUSTOM excluded | Fixed in F |

**Reviewer disagreements, all accepted:**
- read-only enforcement mechanism (F2);
- G4/D-7 placement and severity (F4);
- per-IP limits (F6);
- D-4 lean;
- T10 raised to P1;
- T15 at P1.

**There are no remaining disagreements.**

**Unresolved decisions:**
- **Blocking:**
  - D-1 (AS build vs adopt);
  - G4/D-7 (isolated staging project and DB, plus a staging migration mechanism);
  - D-2 (birth profile; recommended exclusion);
  - D-4 (module location and bundling).
- **Non-blocking:**
  - D-3, D-5, D-6;
  - WAF plan availability;
  - the UNVERIFIED vendor items (Claude's hosted CIMD URL and tool re-surfacing; ChatGPT plan eligibility, limits and timeouts). These can be resolved in D2 or I4, with DCR as the documented fallback.

**Reviewer's overall verdict:** agrees with **CONDITIONAL GO**.
- Not ARCHITECTURE READY: D-1 and G4 are undecided, and the evidence indicates a shared Preview/Production DB.
- Not BLOCKED: both vendors accept CIMD, PKCE S256 and `resource`, the engine reuse is real, and identity-from-token isolation is sound.

---

## L. Final Verdict

**AURA-MCP-02-D1 — CONDITIONAL GO**

The approach is feasible and supported by verified evidence:
- **One design serves both clients.** Claude Web and ChatGPT Web both support remote Streamable HTTP MCP with MCP-conformant OAuth 2.1 (PKCE S256, RFC 8707 `resource`, CIMD with a DCR fallback).
- **The existing engine is reused unchanged.** Aura's timing, Panchangam and Daily Rhythm engine can serve a remote, read-only, personalized `find_best_time` with no duplication and no change to ranking.
- **The hosting fits.** An in-app, stateless route on the existing Vercel deployment is the smallest viable option.

These must be resolved before implementation:
1. **D-1:** Aura has no OAuth authorization server; decide build vs adopt.
2. **G4/D-7:** an isolated, publicly reachable staging project with its own database. Current evidence indicates Preview shares the Production `DATABASE_URL`.
3. **D-2:** exclude birth-profile personalization from v1 (it leaks birth-derived facts via PERSONAL reasons).
4. **D-4:** module location and SDK bundling in `apps/web`.

## M. Recommended Next Action

**MCP-02-D2: Authorization and Staging Decision Record.** This is a decision-and-spike ticket only, with no deployment and no OAuth clients or credentials. Its outputs:
- (a) choose the authorization-server approach (D-1), with a short evaluation of in-app vetted-library vs managed-provider options against Aura's magic-link identity;
- (b) specify the isolated staging project, DB and migration mechanism, and prove its DB isolation from Production;
- (c) record the D-2 and D-4 decisions;
- (d) run a local, non-deployable spike showing Next 14 can bundle `@modelcontextprotocol/sdk`'s Web-standard Streamable HTTP transport in `apps/web`.

Do not start D2 or any implementation phase without explicit authorization.

---

### Open decisions register

| ID | Decision | Owner |
|---|---|---|
| D-1 | Authorization server: in-app with a vetted OAuth library, vs. managed IdP (would require bridging or migrating Aura's magic-link identity) | Product and Eng |
| D-2 | Birth-profile personalization via MCP: exclude in v1 (recommended), or opt-in scope with field disclosure | Product and Privacy |
| D-3 | Allow a per-request location override (travel)? (Recommended: not in v1) | Product |
| D-4 | Location of the shared remote tool module. Lean `packages/mcp-tools` or a module under `apps/web` with dependencies declared in `apps/web`, because of bare-specifier resolution under `externalDir`. | Eng |
| D-5 | Should "sign out everywhere" also revoke assistant grants? | Product |
| D-6 | Record MCP usage in `ProductEvent`? (Recommended: minimal, no arguments) | Product and Privacy |
| D-7 | Staging topology. The evidence favours a separate Vercel project with its own DB; the Preview path bypass is rejected unless Preview DB isolation is proven. Remaining question: the staging migration mechanism. | Eng and Ops |

### Sources (fetched 2026-11-10)

**Fetched successfully:**
- https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp (200)
- https://claude.com/docs/connectors/building (200)
- https://claude.com/docs/connectors/building/authentication.md (200)
- https://claude.com/docs/connectors/building/review-criteria.md (200)
- https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization (200)
- https://modelcontextprotocol.io/specification/2025-11-25/basic/transports (200)
- https://developers.openai.com/api/docs/guides/custom-mcp-server (200)
- https://developers.openai.com/apps-sdk/build/auth (200)
- https://developers.openai.com/apps-sdk/deploy/connect-chatgpt (200)
- https://developers.openai.com/apps-sdk/build/mcp-server (200)
- https://developers.openai.com/plugins/deploy/app-review.md (200)

**Not retrieved:**
- support.claude.com/…/11503834 (404; its content now lives at claude.com/docs)
- platform.openai.com/docs/guides/developer-mode (301, then 404)
- help.openai.com/…/11487775 (403)
