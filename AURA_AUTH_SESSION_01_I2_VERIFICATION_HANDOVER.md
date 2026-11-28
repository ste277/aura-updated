# AURA-AUTH-SESSION-01-I2 — Independent Security Verification Handover

**Ticket:** 39245 (revised). **Scope:** approved Rev 3 §10 I2, the cutover PR, with no Rev 4 and no mode switch. The design (`AURA_AUTH_SESSION_01_REVOCATION_DESIGN.md`, D1–D8) is unchanged.

**Branch:** `feature/aura-auth-session-01-i2`, from main `fd8b8f5`. The PR is a **draft**. Auto-merge and Auto-fix are off.

**Merging this PR is the cutover.** The next Production release from main would carry it, so it stays unmerged until independent verification, the I2-S blockers in §6 and release sequencing are complete. The §4.2 runbook (Steps A–F) is still mandatory and needs its own execution authorization.

**Not done:** merge, Production deployment or migration, credential rotation, cutover, activation, Keychain or GOV-02 work. **No new migration or dependency:** 0055 and 0056 are unchanged, and so are the lockfiles.

## 1. What changed

| Area | Change |
|---|---|
| `lib/session.ts` | The **only** reader of session cookies, and the issuer at sign-in. See the list below. |
| `lib/auth.ts` | **v1 session code removed:** `createSessionToken`, `verifySessionToken`, `SessionPayload` and `SESSION_COOKIE_NAME`. `getAuthSecret()` is added for HKDF. `sign()`/`verify()` stay for magic-link, guest and preview tokens. |
| Sign-in (`verify-code`, local-dev `verify`) | `createSignInSession`: the code consume (`consumeAuthCodeInTransaction`) and the AuthSession INSERT run in **one transaction** on a session-pool connection, under the write budget (SET LOCAL statement 1 500 ms / lock 1 000 ms / idle-in-transaction 5 000 ms, plus a 2 s pre-commit deadline). The commit goes through the R2/R3 `commitAuthSessionTransaction`, then the single-use `releaseCommittedAuthSession`, and only then `setSessionCookie`. Any other outcome is 503 with no cookie; a rollback also leaves the code unconsumed. The non-transactional `consumeAuthCode` is removed. |
| Logout (D8) | `revokeRequestSession`: an idempotent revoke, with at most one retry of an uncertain outcome inside the same 2 s deadline (the I1 contract). The response is 200 and the cookies are cleared **only after** the revoke commits. Otherwise it is 503, **the cookie is kept** and no Set-Cookie is sent. There is no local-only logout. |
| E1 (77 route files, 96 call sites) | `const session = await getSessionFromRequest(req); if (session === SESSION_UNAVAILABLE) return sessionUnavailableResponse();`. 34 routes that loaded the user straight away now use the joined `getSessionWithUserFromRequest` (one round trip, §8). |
| E2 (captures, goals, goals/[id], plan-day) | `getSession[WithUser]FromCookieStore(cookies())`. An outage throws, so the page fails rather than rendering signed out. plan-day verifies once per render, memoised. |
| E3 `/api/auth/session` | Joined lookup; 503 on an outage. It never sets the session cookie (B4) and clears a legacy `as_session` (N6). |
| E4 MCP consent (D6) | `sessionUserFromCookie` is async and database-backed. `/api/mcp/connections` returns 503 on an outage. **B3:** a new optional package hook, `guardConsentGrant`, issues the grant inside `withSessionShareLock`. No other MCP OAuth change. |
| E5 seams (preview, recompose, plan-day bootstrap) | The route or page verifies once, and the seam only passes the verified session on. The bootstrap `verifySession` may be async. |
| B3 | `withSessionShareLock` (FOR SHARE after a live re-check, with server-side timeouts). Its first caller is MCP consent approval. Account deletion and revoke-all routes do not exist yet (design step 3). |
| Cron | The daily `/api/internal/reminders/dispatch` runs `cleanupAuthSessions` (≤ 5 000 rows, statement 5 s / deadline 6 s, deletes only rows expired or revoked for more than 7 days). It is reported in the response, isolated, and still secret-gated. |
| Client (`lib/sessionClient.ts`, Home, You, `/find`) | A 503, non-2xx or offline session check is **unknown**: no sign-out, state kept, retried every 3 s up to 10 times, plus a "Try again" button (N7). Sign-out succeeds only on a 200, with one automatic retry, then the message "Couldn't sign out. Try again." and a disabled button while in flight. |

`lib/session.ts` provides:
- `getSessionFromRequest` / `getSessionWithUserFromRequest`, returning a session, `null` or `SESSION_UNAVAILABLE`;
- the page and header helpers, which throw on an outage;
- `sessionUnavailableResponse()`: 503, `Retry-After`, `no-store`;
- `createSignInSession`, `setSessionCookie` and `issueSessionToken`;
- `revokeRequestSession`, `clearSessionCookies` and `clearLegacySessionCookie`;
- `withSessionShareLock` (B3).

The pool and the HKDF key are created lazily: there is no work at import. The module reads only the active cookie name, `__Host-as_sid` in production and `as_sid` otherwise, with no legacy read and no fallback. The token `exp` must equal the row's `expiresAt`.

**Unchanged I1 contracts:** `authSessionDb.ts`, `authSessionStore.ts`, `authSessionToken.ts` and `sessionErrors.ts` are byte-identical to `1a4bce3`. That covers the bounds, outcome classes, retry rule, commit authorization, transaction binding, single-use release and the 720 h DB-set expiry.

## 2. Review focus (suggested)
1. **No bypass.** `test/authSessionCoverage.test.ts` (rules C1–C11 plus 17 negative fixtures) and its `PUBLIC_ROUTES` list (10 routes, each with a reason). Check that every list entry really is non-cookie-authenticated.
2. **Outage is never 401.** Every E1 call site, `/api/auth/session`, and the E2 throw behaviour.
3. **Sign-in transaction** (`createSignInSession`): the discard and rollback paths, and that no cookie is issued without a `CommitAuthorization`.
4. **D8 logout**, B1, and **B3 ordering**, including the cross-database consent case. The lock is held on the Aura database while the grant is written to the OAuth store.
5. **The checked-out client `error` listener** in `createSignInSession` and `withSessionShareLock`. A dropped connection on a checked-out client would otherwise crash the process; a fault test found this (G1).
6. **The client N7 behaviour** in `app/page.tsx`. The old catch path signed the user out on any refresh error, and that is changed.

## 3. Evidence
See `AURA_AUTH_SESSION_01_I2_EVIDENCE/` (with its `SHA256SUMS`) for the local logs and the hosted CI run.

New suites:

| Suite | What it covers |
|---|---|
| `authSessionI2Db` | Real routes and NextRequest on a disposable PostgreSQL. |
| `authSessionCoverage` | Static rules, no database. |
| `authSessionClient` | Client outcome logic. |

`authSessionI2Db` covers sign-in, cookie attributes, single use, concurrency (6×), COMMIT faults (G1–G3), E1/E3/E4, isolation, 8 tamper and foreign-token cases (including **a v1 token signed with the current secret**), DB-clock expiry, token/row binding, D8, B1 (20 concurrent replays), B3 in both directions, DB-down and hung-DB 503s, the production `__Host-` contract, the cron cleanup, and checks for leaked backends.

The I1 suites are retained. `authSessionToken` now asserts that the v1 API is gone and that a v1-shaped token signed with the current secret is rejected. The I1 dormancy guard is **removed by design** ("I2 removes the guard").

About 61 route and regression tests that minted v1 tokens now use real v2 sessions through `test/authSessionTestSupport.ts`, so they exercise the database-backed path.

## 4. Deviations and notes (for the verifier)
- **MCP consent outage.** The package's `currentAuraUser` maps a thrown lookup to "sign in required" (401 page). That is existing package behaviour, kept unchanged under D6. It fails closed: no grant is issued, but the user sees a sign-in page rather than a 503. `/api/mcp/connections` does return 503.
- **The B3 consent hook** (`guardConsentGrant`) is unit-covered through `withSessionShareLock`, B3-1 and B3-2. A full OAuth-flow test of the hook is **recommended** before activation. MCP is local-only, and Production is `reject_all`.
- **Prod cleanup** runs only when the dispatch secret is configured. It is absent in Production today (INFRA-01). Without it the allowlist stays correct; only the table grows. Record this in the release plan.
- **E2 pages fail on an outage** with the framework error page. There is no `app/error.tsx`; adding one is a UX follow-up, not a security issue.
- **`/api/auth/session` clears only `as_session`.** It never clears v2 cookies, so a concurrent sign-in in another tab is never undone.

## 5. Not changed
- Open registration (`getOrCreateUserForAuth`), the AUTH-01 rate limits and the AUTH-02 magic-link gate.
- MCP OAuth tokens, store and activation.
- Android and iOS native code. No native code reads sessions. The REL-02 cookie plugin is unshipped and must use the new names before it ships (design §6).
- The cookie contract is unchanged from I1 (`__Host-as_sid` / `as_sid`; HttpOnly; Lax; `/`; no Domain; Max-Age from the DB expiry).
- The 30-day fixed expiry (D4), with no sliding renewal.

## 6. Release blockers (I2-S, not completable here)
None of these can be completed without a staging deployment and devices, which are not authorised in this ticket. Each stays an **explicit blocker** before the cutover release:

| # | Item | Status |
|---|---|---|
| N1–N8 | Native device matrix (design §9.1): Android at the WebView 91 floor plus a current device; iOS 13 floor plus a current device | **BLOCKER: not run.** It needs I2-S staging. No AVD or device was used: the frozen-AVD policy applies, and the Rev 6.10 dedicated AVD has not been created. |
| S1 | Neon pooler and connection limit with the extra 5-connection `aura-session` pool | **BLOCKER: not run** (needs staging) |
| S2 | Real Neon p50/p95 for authenticated routes, before and after | **BLOCKER: not run** (needs staging) |
| S3 | Web N4/N6/N7 on staging (server expiry, legacy cookie at cutover, offline) | Automated here (X1, T-v1, F1–F9 and the client test). A staging confirmation is still required. |
| R | §4.2 runbook, Steps A–F with Gates A/D/F (including R0-safe before any retirement) | Owner-run, under separate authorization |
