# AURA-MCP-02-D2: Authorization and Staging Decision Record

- **Date:** 2026-11-10
- **Predecessor:** AURA-MCP-02-D1 (`AURA_MCP_02_D1_ARCHITECTURE_AUDIT.md`), CONDITIONAL GO
- **Authorization:** decision record plus local, non-deployable spikes only

**Not done:** no repository changes, commits, pushes, deployments, environments, credentials, OAuth clients or Production access. All spike code lived in the session scratchpad on a `git archive` copy of `origin/main` `9a487a9`. The repository working tree is unchanged.

---

## 1. Decisions at a glance

| ID | Question | Decision | Status |
|---|---|---|---|
| **D-1** | Authorization server: build in-app or adopt a managed provider | **In-app with panva `oidc-provider`**; managed WorkOS Standalone Connect remains the documented alternative | **CONFIRMED by owner on 2026-11-10 ("Confirm A (in-app)")** |
| **D-2** | Birth-profile personalization over MCP | **Excluded from v1.** No `personalContext` is passed. Any later opt-in needs its own scope and disclosure. | **CONFIRMED by owner on 2026-11-10 ("Confirm exclusion")** |
| **D-4** | Module location and SDK | **`packages/mcp-tools`** holds one shared tool definition (schema, executor, metadata). `zod` and **`@modelcontextprotocol/server` 2.x (SDK v2)** are declared in the **root** `package.json`. `apps/mcp` should eventually import from the package, not the reverse (see §2.1). | **Decided by spike evidence plus the Vercel install command** |
| **G4 / D-7** | Staging topology | **Separate Vercel project with its own empty Postgres** (not a Neon branch of Production). Preview is ruled out. | **Decided by evidence**; creating it needs separate authorization |
| **G7** | Pooled DB URL | `DATABASE_URL` is very likely the Neon pooled URL: a separate `DATABASE_URL_UNPOOLED` exists, per Neon integration convention. Values were not read. | Inferred; confirm in I1 |
| D-3 | Per-request location override | Not in v1 | Recommended (non-blocking) |
| D-5 | "Sign out everywhere" revokes assistant grants? | No. Disconnecting an assistant is a separate, explicit action. Pre-existing sessions can't be revoked anyway (stateless HMAC). | Recommended (non-blocking) |
| D-6 | Record MCP usage in `ProductEvent` | One event per call: `{source:'MCP', clientHost, resultCount, durationMs}`. No arguments, no `taskTitle`. | Recommended (non-blocking) |

---

## 2. Evidence

### 2.1 SDK bundling spike (D-4): PASS

**Setup:**
- A scratch copy of `apps/web`, `apps/mcp`, `packages` and the root `package.json` from `origin/main`.
- Installs mirror CI's `web-build` job: root `npm install`, then `apps/web` `npm install`.
- `next build` used placeholder env values only.

| Step | Result |
|---|---|
| Build with **only** `apps/web` deps installed (no root `node_modules`) | **Fails, including existing code:** `Can't resolve 'astronomy-engine'` from `packages/vedic`, `packages/muhurta`, `packages/recommendation`. Also `Can't resolve 'zod'` from `apps/mcp/src/schemas`. |
| **Finding** | Files outside `apps/web` resolve bare specifiers from the **repository-root** `node_modules`, not `apps/web/node_modules`. CI's `web-build` relies on `npm install` at the root. **Vercel does the same:** `vercel project inspect aura-updated` shows Install Command `npm install --prefix ../.. && npm install`, Root Directory `apps/web`, **Node.js 24.x**. Both steps are `npm install`, not `npm ci`, so exact root pins plus the lockfile are what keep versions stable. |
| Rebuild with root deps plus `zod@4.6.7` and `@modelcontextprotocol/server@2.4.0` added to **root**, and the SDK removed from `apps/web` | **✓ Compiled successfully.** `ƒ /api/mcp` (dynamic) and `○ /.well-known/oauth-protected-resource`. Type-check passed. |

**Spike shape:**
- `packages/mcp-tools/src/remoteServer.ts`:
  - creates an SDK v2 `McpServer`;
  - registers `find_best_time` with the **unchanged** MCP-01 `findBestTimeObjectSchema` and `executeFindBestTime` (imported from `apps/mcp/src`);
  - re-exports `WebStandardStreamableHTTPServerTransport`, so the SDK resolves from a single place.
- `apps/web/app/api/mcp/route.ts`:
  - POST only;
  - stateless (`sessionIdGenerator: undefined`, `enableJsonResponse: true`);
  - Origin check;
  - stub bearer gate with a fixed local test token.

**In-process invocation of the compiled handlers** (no server, no network):

| Probe | Result |
|---|---|
| `GET /.well-known/oauth-protected-resource` | 200, RFC 9728 JSON |
| `tools/list` with no token | **401**, `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource", scope="aura.planning.read"` |
| `Origin: https://evil.example` | **403** |
| No `Origin` header (server-to-server) | Accepted |
| `GET /api/mcp` | 405 |
| `initialize` (protocol 2025-11-25) | 200; server advertises `tools.listChanged` |
| `tools/list` | `find_best_time`, `readOnlyHint=true` |
| `tools/call` (Morning run, 45 min, TOMORROW, MORNING, New York) | 3 candidates (2 CAUTION, 1 USABLE), `isError=false` |
| **Parity:** remote candidates vs. the MCP-01 stdio adapter called directly with the same arguments | **Deep-equal: true** |
| `userId` injected into arguments | Rejected: `Unrecognized key: "userId"` |

**Why SDK v2 (`@modelcontextprotocol/server`) for the remote path:**
- **Smaller dependency tree:** 2.4.0 depends only on `zod` and `@modelcontextprotocol/core`. The v1 `@modelcontextprotocol/sdk` 1.32.2 pulls 17 direct deps (express, hono, `@hono/node-server`, jose, cors, express-rate-limit, cross-spawn, …), which addresses T18.
- **Support window:** per the SDK docs, v1 gets fixes for "at least six months" after the v2 release (2026-07-27).
- **Ready-made auth pieces:** v2 ships `requireBearerAuth`, `buildOAuthProtectedResourceMetadata` and `bearerAuthChallengeResponse` for web-standard Request/Response.

`apps/mcp` stays on v1 1.32.2, untouched. Migrating it is a separate, behaviour-preserving ticket guarded by its 39 tests.

**Consequences for I1** (refined by the independent review):
1. Add `zod` and `@modelcontextprotocol/server` (exact pins) to **root** `package.json` and lockfile, following the existing `astronomy-engine` convention for `packages/*`.
2. Import the transport only through `packages/mcp-tools`, so there is a single SDK copy.
3. **One zod copy, not just one SDK copy.** `apps/mcp/src/schemas` imports `zod` by bare specifier. When `apps/mcp/node_modules` exists (always, locally, after the MCP tests run), the schema would bind to that zod while the SDK binds to the root copy. That gives two instances in one bundle, which works only while both are pinned to 4.6.7. Also, the spike's `packages/mcp-tools → apps/mcp` import is layered backwards. **I1 resolution:** move the schema and executor into `packages/mcp-tools` and have `apps/mcp` import them, with the 39 tests as the behaviour guard. As a minimum alternative, add a webpack alias of `zod` to the root copy plus a CI check that root and `apps/mcp` zod pins match.
4. **Shared tool definition plus a cross-transport parity test.** Register tool metadata (title, description, annotations, schema) from one object for both the stdio (v1) and HTTP (v2) servers. Add an I1 test that `tools/list` and call results match across both. The spike's title already drifted ("Find best time (spike)").
5. **Schedule the `apps/mcp` v1→v2 migration** before late January 2027, the end of v1's guaranteed fix window. Don't leave it open-ended.
6. **Docker path:** `deploy/Dockerfile` (`node:20-alpine`, Railway per DEPLOY.md) copies `packages` and `apps/web` but not `apps/mcp`. Moving the shared code into `packages/mcp-tools` (point 3) fixes this. Otherwise I1 must update the Dockerfile or formally retire it.
7. The PRM route must also return 404 when the flag is off.
8. Committed I1 tests must pass on CI's Node version. The spike ran on local Node 26.5; SDK v2 declares `engines >=20`.

### 2.2 Staging and database evidence (G4/D-7)

`vercel env ls` for `aura-56a1/aura-updated` (names and scopes only; no values were read or pulled):

- **`DATABASE_URL` is a single variable record scoped to "Preview, Production",** so both environments use the **same value**. This is stronger than D1's "presumed".
  - The same applies to `DATABASE_URL_UNPOOLED`, `POSTGRES_*`, `PG*` and `NEON_PROJECT_ID`, which come from the Neon integration.
  - `AUTH_SECRET` has **two separate records** (Preview and Production).
- **Caveat:** branch-scoped Preview overrides or the Neon integration's per-preview branching would appear as separate rows or deployment-level variables. None appear in the listing. The conservative conclusion stands either way.
- **Conclusion: Preview deployments use the Production database.**
  - No MCP or OAuth work may run on Preview.
  - A Neon *branch* of Production would copy real user data, so it is **not acceptable** for staging.

**Staging specification** (to be created only under separate authorization):

| Item | Specification |
|---|---|
| Project | A new Vercel project (for example `aura-mcp-staging`) on the same repo, root directory `apps/web` |
| Database | A **new, empty** Postgres (a separate Neon project, or an empty database with no Production lineage), seeded only with synthetic test users |
| Secrets | Its own `AUTH_SECRET`, OAuth signing keys and cookie keys. Nothing shared with Production. |
| Migrations | `vercel-build.sh` migrates only when `VERCEL_ENV=production`, so it currently skips staging Previews. In I1/I2, add an **explicit opt-in** variable (for example `AURA_MIGRATE_ON_BUILD=1`) set **only** in the staging project. `aura-updated` Preview stays unchanged. |
| Protection | Vendor clouds must reach `/api/mcp`, `/.well-known/*` and `/oauth/*`. Use a protection-off staging project containing synthetic data only, plus `AURA_MCP_REMOTE_ENABLED=1` there only. |
| Domain | A stable custom staging domain. This is the canonical RFC 8707 `resource`; see D1 T4. |
| Isolation check (gate) | Before I2 staging tests: prove `DATABASE_URL` host and database differ from Production by comparing Neon project IDs (not secrets) in the Neon console. Record it in the I2 report. |

### 2.3 Authorization server options (D-1)

Research covered official vendor docs and READMEs on 2026-11-10. A local discovery probe confirmed the `oidc-provider` features below.

| Criterion | **A. In-app `oidc-provider` 9.13.3** | **B. WorkOS Standalone Connect** | C. Better Auth `mcp()` | D. Descope BYO Auth | E. Stytch / Clerk | F. MCP SDK AS helpers | G. Hand-rolled |
|---|---|---|---|---|---|---|---|
| Keeps Aura's email-code login and users | ✓ interaction flow resumes with any `accountId` | ✓ Aura login page gets `external_auth_id`; backend calls `POST /authkit/oauth2/complete` with `{id, email}` | ✗ needs a Better Auth session (migration) | ✓ external auth completion via management API | ✗ requires their user system | — | ✓ |
| PKCE S256-only | ✓ (probe: `["S256"]`, `pkce.required`) | ✓ | ✓ | UNVERIFIED | partly | — | own code |
| RFC 8707 audience | ✓ `resourceIndicators` + `getResourceServerInfo` | ✓ | ✓ | partly | partly | — | own code |
| RFC 9207 `iss` (ChatGPT stable redirect) | ✓ (probe: `true`) | UNVERIFIED | ✓ | UNVERIFIED | — | — | own code |
| CIMD | ✓ **experimental draft-02** (probe: `true`). The **`allowClient` hook allowlists claude.ai and chatgpt.com.** | ✓ (enable for Standalone); **no client-host allowlist found** | ✓ draft-00 | ✓ | Beta / ✓ | ✗ | own code |
| DCR fallback | ✓ (off by default; policies) | ✓ | ✓ (off by default) | ✓ | ✓ | legacy | own code |
| Token type and revocation | **Opaque**, stored in Aura Postgres (custom adapter); immediate revocation; `rotateRefreshToken` | JWT (5 min default), JWKS; per-user and per-client revoke API; **refresh tokens have no max or idle lifetime**; access tokens stay valid ≤5 min after revoke | JWT/opaque | JWT | JWT | — | own code |
| Aura user id in token | `accountId` = Aura `User.id` | `sub` = **WorkOS** user id; Aura id is `external_id`, so it needs a lookup or a local mapping | — | UNVERIFIED | — | — | — |
| New data processor | **None** | **Yes**: WorkOS stores id, email and name per connected user; DPA/residency UNVERIFIED | No | Yes | Yes | — | None |
| Cost | $0 | AuthKit free to 1M MAU; **Connect/Standalone pricing UNVERIFIED**; custom domain line $99/mo | $0 | Free tier 7,500 MAU / 2,000 consents | varies | — | $0 |
| Runtime and framework fit | Koa-based Node `req,res`, ESM-only. **Warns** (doesn't fail) below Node 22 LTS; no `engines` field. **Vercel already runs Node 24.x**, which passes. CI (20) and `deploy/Dockerfile` (20) lag behind Vercel, a pre-existing mismatch. Mount via a Next **Pages Router API route** (`pages/api/oauth/[...oidc].ts`, `bodyParser:false`), which Next 14 supports alongside `app/`. **Not yet built:** I2's first gate. | HTTP API from route handlers; no runtime constraint | Next App Router examples | HTTP API | — | v2 docs: "Use a dedicated identity provider" | — |
| Dependency footprint | About 41 packages (koa, jose, cookies, keygrip, …) | HTTP API (SDK optional) | Large (Better Auth) | HTTP API | SDKs | — | none |
| Protocol surface | **An OIDC provider used as an OAuth server.** It adds `openid` to scopes automatically, exposes userinfo and end-session endpoints, and serves `/.well-known/openid-configuration`. MCP needs only OAuth 2.1, so minimize the OIDC surface. | OAuth AS (OIDC-compatible) | OAuth/OIDC | OAuth/OIDC | — | — | own |
| Maintenance | Sole maintainer; OpenID-certified lineage; v9 is the supported line | Vendor | Org | Vendor | Vendor | frozen | Aura |
| Security-critical code Aura owns | Config, adapter, interaction and consent pages | Login completion, mapping, revoke UI, compensating controls | — | similar to B | — | — | **All** |

**Recommendation: Option A (in-app `oidc-provider`).**

Why A:
- It is the only option that meets all D1 security properties without compensating code:
  - opaque, immediately revocable tokens in Aura's own database;
  - a CIMD client-host allowlist (shown via `allowClient`);
  - S256-only PKCE, RFC 8707 audience binding, and RFC 9207 `iss` (shown in discovery);
  - refresh-token rotation;
  - no new subprocessor and no recurring cost.
- It authenticates users with Aura's existing email-code login unchanged.

Costs and risks of A:
1. **Node runtime:** no Vercel change is needed (already 24.x). Align CI and `deploy/Dockerfile` from Node 20 to Vercel's 24 so tests run on the production runtime. That also fixes an existing mismatch.
2. Mounting a Koa/Node `req,res` provider in Next 14 through a Pages Router API route is feasible but unbuilt. **I2 gate 1:** build that mount locally and pass discovery, authorize and token. This needs:
   - issuer and path rewrites so `/oauth/*` and **both** discovery URLs that MCP clients probe (`/.well-known/oauth-authorization-server` per RFC 8414 and `/.well-known/openid-configuration`) resolve;
   - a provider instance per cold start, backed by the DB adapter;
   - userinfo, end-session and claims disabled or minimized (OIDC surface).
3. CIMD is experimental (draft-02). Breaking changes can land in minor versions, so pin exactly. Whether Claude and ChatGPT interoperate with draft-02 is unknown, so **DCR may be the real launch path.** Decide the DCR policy now:
   - **policy-gated registration, not open:** accept only if every `redirect_uri` is exactly `https://claude.ai/api/mcp/auth_callback` or `https://chatgpt.com/connector_platform_oauth_redirect`, and `token_endpoint_auth_method` is `none`;
   - the consent label is derived from the redirect host, never from `client_name`;
   - per-IP registration rate limit;
   - stale clients with no grants pruned after 30 days.

   CIMD vs DCR is a **configuration switch tested in I4**.
4. A Postgres adapter must be written. Atomic `consume` and replay detection are required by the library docs.
5. Signing keys (JWKS) are still needed for `id_token` / OIDC, adding one key-management item.
6. Single-maintainer dependency.

**When to choose B (WorkOS) instead:** if the owner prefers not to own authorization-server code and accepts a new processor of user id, email and name. B then needs compensating controls:
- an Aura-side `sub` → `User.id` mapping table;
- a scheduled job that revokes grants older than about 90 days (refresh tokens never expire);
- a resource-server check of the client identity, since CIMD can't be allowlisted. Whether the token carries `client_id`/`azp` is UNVERIFIED.

B also needs pricing and DPA confirmation before any sign-up.

**Rejected:**
- C: forces an auth migration.
- E: requires the vendor's own user system.
- F: frozen and not recommended for new servers.
- G: hand-rolling the most security-critical component is unjustified when A exists.
- D is viable but offers nothing over B for Aura, and holds a management key in the app.

### 2.4 Changes to the D1 design caused by these decisions

- **Tokens (Option A):** opaque tokens and the Postgres-backed grant, code and token tables stand as designed in D1. `oidc-provider` stores them through the custom adapter. The D1 table names become adapter models (a generic `OidcPayload(id, kind, payload jsonb, grantId, userCode, uid, expiresAt, consumedAt)` table plus a `Grant` view, per the library's adapter interface).
- **Consent and step-up:** these stay Aura-owned interaction pages (`interactions.url`), served from the Next app and reusing the 6-digit code.
- **Remote tool:** uses SDK v2. `requireBearerAuth` takes a custom verifier that looks up the opaque token through the provider's adapter, checking `resource`, `scope`, `exp` and revocation, and yields `accountId` as `User.id`.
- **Spec version:** a newer MCP specification revision ("2026-07-28", referenced by Better Auth's profile) may exist. SDK v2.4.0's `LATEST_PROTOCOL_VERSION` is still 2025-11-25. **I2 must diff the authorization section of any newer revision** before freezing the design.

---

## 3. Updated implementation sequence

| Phase | Scope | Preconditions | Acceptance gate |
|---|---|---|---|
| **I1: Remote transport foundation** | `packages/mcp-tools`; root deps (`zod`, `@modelcontextprotocol/server` exact); `/api/mcp` (stateless, POST-only, Origin rule, 16 KB body cap, ≤14-day window); PRM route; **auth gate that always returns 401 in deployed builds**; flag `AURA_MCP_REMOTE_ENABLED` default off (404 when off) | D-4 (done) | Spike results reproduced as committed tests; existing 39 MCP-01 tests untouched and green; flag-off 404; Preview build log confirms root install |
| **I1.5: Runtime alignment and staging** | Align CI and `deploy/Dockerfile` Node 20 → 24 (Vercel is already 24.x), run the full regression suite; create the staging project and empty DB; add the opt-in migration variable | **Separate authorization for infrastructure creation** | Full CI green on Node 24; staging isolation proof recorded |
| **I2: Authorization server** | `oidc-provider` via Pages API mount, with issuer rewrites and both discovery URLs; OIDC surface minimized; Postgres adapter; interactions (email code, step-up, consent with CSRF/frame protection); CIMD allowlist **and** policy-gated DCR behind a config switch; refresh rotation; revocation; Connected-assistants UI | I1, I1.5, D-1 = A confirmed | Gate 1: local mount passes discovery (both URLs), authorize and token. Then the D1 auth matrix and T15–T19 pass locally and in staging. |
| I3 / I4 / I5 | As in D1 §J | — | As in D1 |

If the owner chooses **B**, I2 becomes WorkOS integration plus the compensating controls. The CI and Docker Node alignment is still worth doing.

---

## 4. Open items

| Item | Blocking? | Where it gets resolved |
|---|---|---|
| ~~Owner confirmation of D-1~~ | **Closed:** A confirmed on 2026-11-10 | — |
| ~~Owner confirmation of D-2~~ | **Closed:** exclusion confirmed on 2026-11-10 | — |
| Claude and ChatGPT interoperability with CIMD draft-02 (A) | No (DCR fallback) | I4 |
| ~~Vercel install covers root deps~~ | **Closed:** the install command is `npm install --prefix ../.. && npm install` | — |
| CI and Docker Node 20 vs Vercel 24 alignment | No (pre-existing mismatch) | I1.5 |
| DCR policy (now decided, §2.3 cost 3) vs CIMD switch | No | I2 / I4 |
| zod single-instance and shared-definition refactor | Part of I1 acceptance | I1 |
| Newer MCP spec revision's authorization changes | No | I2 design freeze |
| WorkOS pricing, DPA, residency, CIMD allowlist, client claim | Only if B | Before any B sign-up |

---

## 5. Verification of restrictions

| Check | Result |
|---|---|
| Repository | HEAD `f35d35a` unchanged; no tracked modifications; only new untracked report files |
| Spike location | Session scratchpad only: `d2-spike` (Next build), `d2-probe` (SDK inspection), `d2-oidc` (provider discovery on 127.0.0.1, ephemeral, closed immediately) |
| Vercel | Read-only `vercel env ls` (names and scopes; values hidden) and `vercel project inspect aura-updated` (settings). No env changes, no pulls, no deployments, no project creation. |
| Baseline note | Local `main` is `f35d35a`, behind `origin/main` `9a487a9`. All spikes were built from `9a487a9`. |

---

## 6. Independent review

**Reviewer:** an independent subagent with read-only access. It did not author this record. It re-ran `probe.cjs` and the `oidc-provider` discovery probe, and every claim reproduced.

**Verdict: APPROVE WITH NOTES.** Nothing blocks I1. All findings were applied above, and the author confirmed F1, F2 and F3 directly.

| ID | Sev | Finding | Disposition |
|---|---|---|---|
| F1 | P1 | "Requires Node ≥22" was wrong for Vercel: Vercel already runs 24.x; `oidc-provider` only warns below 22 LTS; only CI and Docker are on 20 | Fixed (§2.3 row and cost 1, I1.5) |
| F2 | P2 | The root install is proven by the Vercel install command | Fixed; open item closed |
| F3 | P2 | `deploy/Dockerfile` omits `apps/mcp`, so the spike's import shape would break the Docker build | Fixed (I1 consequence 6) |
| F4 | P2 | Duplicate zod risk, and an inverted package→app dependency | Fixed (I1 consequence 3) |
| F5 | P2 | v1/v2 metadata drift; v1 fix window | Fixed (consequences 4–5) |
| F6 | P2 | OIDC surface understated; discovery URL handling | Fixed (table row, cost 2, I2) |
| F7 | P2 | DCR named as the fallback while I2 said "DCR off" | Fixed (DCR policy decided; config switch) |
| F8 | P3 | Dependency comparison one-sided | Fixed (footprint row) |
| F9 | P3 | G4 caveat about branch-scoped overrides | Fixed |
| F10 | P3 | Pages mount feasible; needs rewrites and per-cold-start setup | Fixed (cost 2) |
| F11 | P3 | Restriction claims accurate; local `main` is behind | Noted (§5) |
| F12 | P3 | Spike ran on Node 26 only | Fixed (consequence 8) |

**The reviewer agrees D-1 should go to the owner with A recommended.**
- Its reasons for A: no new processor, immediately revocable opaque tokens, a CIMD allowlist, no recurring cost.
- Its caveat: the single-maintainer risk and ongoing security ownership are real and should stay prominent. B remains legitimate if the owner doesn't want to own authorization-server code.

---

## 7. Verdict and next action

**AURA-MCP-02-D2: DECISIONS RECORDED.**
- **D-1 = A** was confirmed by the owner on 2026-11-10.
- **D-2** (exclude birth profile) was confirmed by the owner on 2026-11-10.
- No blocking decisions remain. D-3, D-5 and D-6 are non-blocking recommendations.

- **Decided by evidence:**
  - D-4 (`packages/mcp-tools`, SDK v2, root deps, a single zod instance);
  - G4/D-7 (Preview shares the Production DB, so use a separate staging project with an empty DB);
  - G7 (pooled URL very likely).
- **Recommended, awaiting owner confirmation:**
  - **D-1 = A**: in-app `oidc-provider`;
  - **D-2**: exclude the birth profile from v1;
  - D-3, D-5 and D-6 (non-blocking).

**Next ticket:** MCP-02-I1, Remote Transport Foundation (scope in §3 plus the I1 consequences in §2.1). It doesn't depend on D-1 or D-2 and can start once authorized. I1.5 (infrastructure) and I2 each need separate authorization.
| Accounts | No OAuth clients, credentials or vendor accounts created; no Production data accessed; no migrations |
