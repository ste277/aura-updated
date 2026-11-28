# AURA-AUTH-SESSION-01 — Server-Side Session Revocation Design (Rev 3, FINAL)

**Date:** 2026-11-26 · **Status:** **DESIGN TICKET CLOSED.** All decisions D1–D8 are accepted. I1 is **on HOLD** until the REL-05 cut and explicit implementation authorization.
**Rev 4 amendment (2026-11-28, owner decision 39249/39250):** B3 for **MCP consent only** — see the B3 row and §3.1. Every other Rev 3 decision is unchanged.
**Rev 3 changes:** §4.2–4.3 cutover and rollback safeguards (D3 conditions) · §8.1 database-enforced lookup bounds · §9.1 native device verification · §10 migration coordination with My People MP-1, and the docs travel in the I1 PR.
**Worktree / branch:** `.claude/worktrees/auth-session-01`. Written on `docs/aura-auth-session-01-revocation-design` (from `main` `3feff03`). Committed with the I1 implementation on `feature/aura-auth-session-01-i1`; see `AURA_AUTH_SESSION_01_I1_VERIFICATION_HANDOVER.md`.
**Companion:** `AURA_AUTH_SESSION_01_I1_TICKET.md` (the first implementation ticket) · `AURA_AUTH_SESSION_01_EVIDENCE/` (benchmark script and output).
**Not done:** no route code, migrations, migration execution, credential rotation, Production or Vercel access, merge or deploy. Other workstreams were not touched.

## Owner decisions

| # | Decision | Status |
|---|---|---|
| D1 | Server-side session allowlist, unique session id, separate signing key, centralized enforcement | **Approved** |
| D2 | Everyone signs in again once at cutover | **Approved** |
| D3 | Rollback and legacy invalidation | **Approved with the cutover safeguards in §4.2–4.3** |
| D4 | Session lifetime | **Approved:** fixed 30-day expiry enforced by the server |
| D5 | Separate release after REL-05 | **Approved** |
| D6 | Move the MCP consent screen to central session validation only (no MCP OAuth or activation change) | **Approved** |
| D7 | "Sign out everywhere" and device list | **Approved:** backend only |
| D8 | Logout behaviour when the database fails | **Approved:** durable revocation before reporting success. **No local-only logout fallback.** |

**Authorized now: nothing operational.** That means no credential rotation, deployment deletion, Production or Vercel access, migration execution or implementation. Every step in §4.2 happens only at the cutover release, under its own authorization.

---

## 1. Current architecture (main `3feff03`), summary

- **Token.** A hand-rolled HMAC-SHA256 token keyed by `AUTH_SECRET` (`lib/auth.ts`). Its payload is `{userId, email, exp}`, valid for 30 days. It has **no session id and no type tag**, and it uses the same `sign()`/`verify()` and key as four other token types (§4.3).
- **Logout** (`POST /api/auth/logout`) only clears the cookie and records nothing on the server. A copied cookie stays valid until it expires.
- **Validation entry points:**
  - **E1:** `lib/session.ts` (sync), used by 76 API route files.
  - **E2:** four server pages that call `verifySessionToken` directly.
  - **E3:** `/api/auth/session`.
  - **E4:** the MCP consent check, `lib/mcpLocalOAuth.ts sessionUserFromCookie`.
  - **E5:** three injected-session seams.
- **Account deletion** does not exist on `main`. 34 of the 76 routes never load the user row.
- **Android and iOS** are Capacitor shells that load the hosted web app (`server.url`). The session is the WebView cookie, and no native code stores a token.

---

## 2. Design (unchanged where approved)

### 2.1 Model
`AuthSession` is an **allowlist**: a request is authenticated only if the signed token verifies **and** a matching row exists that is not revoked and not expired. A missing row means not authenticated, and a failed lookup means 503.

```sql
CREATE TABLE "AuthSession" (
  "idHash"       TEXT           PRIMARY KEY,               -- base64url(sha256(sid)); raw sid never stored
  "userId"       TEXT           NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,  -- "User".id is TEXT (0001)
  "createdAt"    TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "expiresAt"    TIMESTAMPTZ(3) NOT NULL,                  -- set by the DB: now() + 720 hours (R1)
  "revokedAt"    TIMESTAMPTZ(3),
  "revokeReason" TEXT CHECK ("revokeReason" IN ('logout','logout_all','account_deleted','admin')),
  CHECK (("revokedAt" IS NULL) = ("revokeReason" IS NULL))
);
CREATE INDEX "AuthSession_userId_active_idx" ON "AuthSession"("userId") WHERE "revokedAt" IS NULL;
CREATE INDEX "AuthSession_expiresAt_idx"     ON "AuthSession"("expiresAt");
```
The table stores no email, IP address or user agent.

### 2.2 Token v2
```
sid        = randomBytes(32)                                  // 256-bit CSPRNG
payload    = { typ:"aura.session", v:2, sid, uid, iat, exp }  // exp copied from the row's expiresAt
token      = b64url(payload) "." HMAC-SHA256(K_session, b64url(payload))
K_session  = HKDF-SHA256(ikm=AUTH_SECRET, salt="aura.session", info="aura-session-v2", 32 bytes)
```
The verifier is strict:
- `typ` and `v` must match exactly;
- `sid` must be 43 base64url characters and `uid` a UUID;
- `iat ≤ now+60s < exp`;
- the signature is compared in constant time;
- no other token type verifies.

The old `verify()` rejects v2 because it uses a different key.

### 2.3 Central enforcement
`lib/session.ts` becomes the only reader of session cookies:
- `getSessionFromRequest`, which becomes async;
- `getSessionFromCookieStore` (server pages);
- `getSessionFromCookieHeader` (MCP consent, D6).

It adds `withSession()` and `sessionUnavailableResponse()`, which returns 503 with `Retry-After`. A static coverage test, based on REL-02-A2 (§6), enforces this.

### 2.4 Sign-in, logout, revocation and deletion
- **Sign-in** (`verify-code`, and `verify` in local dev): `consumeAuthCode` and the `INSERT AuthSession … RETURNING "expiresAt"` run in **one transaction**. R2 (39235) adds a typed sequence: `createAuthSessionInTransaction` (provisional, no raw id), then `commitAuthSessionTransaction` (only an **acknowledged** COMMIT yields a `CommitAuthorization`), then `releaseCommittedAuthSession` (live matching row, then a cookie-issuable session). An ambiguous COMMIT never releases session material; `classifyAmbiguousCommit` may only label the database outcome. **R3 (39237):** the authorization is bound to the exact transaction that ran the INSERT (its `txid_current()`), checked in the same message as the COMMIT. Release is single-use: the authorization is consumed synchronously before the read-back and never restored. The cookie is set only after COMMIT. If the commit outcome is ambiguous, the response is 503 with no cookie. An orphan row can never be used, because its `sid` was never disclosed.
- **Logout:** an idempotent `UPDATE … SET "revokedAt"=now() WHERE "idHash"=$1 AND "revokedAt" IS NULL`. Zero rows still counts as success. The cookie is cleared and 200 returned **only after the commit is confirmed**. If the outcome is ambiguous, it retries once, then returns 503 (D8).
- **Revoke-all:** `revokeAllSessionsForUser(client, userId, reason)`.
- **Account deletion:** calls revoke-all inside the deletion transaction. The FK cascade then removes the rows.
- **Cleanup:** a bounded `DELETE … LIMIT 5000` of rows that are expired or revoked for more than 7 days, run from the **existing daily cron**. Because the table is an allowlist, removing rows can never re-enable a session.

---

## 3. Concurrent-request boundary during logout

**The boundary is the COMMIT of the revoking statement** (logout, revoke-all, or account deletion).

| Rule | Guarantee |
|---|---|
| **B1** | Every request whose session lookup statement **starts after** that commit gets **401**. This is guaranteed by READ COMMITTED, since each statement takes a fresh snapshot, and there is no cache. |
| **B2** | A request whose lookup **finished before** that commit may complete. It is bounded by that request's own run time, which is capped by the function's maximum duration. This is accepted for ordinary reads and writes, because the user already held a valid session when the request began. |
| **B3** | **Session-sensitive operations** re-check the session **inside their own transaction** with `SELECT 1 FROM "AuthSession" WHERE … FOR SHARE`: account deletion and revoke-all. Logout's `UPDATE` conflicts with `FOR SHARE`, so the order is strict: either the operation commits before the logout, or the logout commits first and the operation fails with 401. **Rev 4:** MCP consent approval (D6) uses the authorization-finalization guarantee in §3.1 instead, because its grant is written to the separate MCP OAuth database. |
| **B4** | **Only sign-in sets the session cookie.** There is no sliding renewal and no re-issue on any other response. So a concurrent in-flight response can never put a cookie back after logout cleared it. |
| **B5** | Account deletion: concurrent writes either commit before the deletion transaction locks the `User` row (`FOR UPDATE`), in which case they are deleted with it, or they wait and then fail their FK check. No data is left behind. |
| **B6** | The client stops sending authenticated calls once logout starts, and treats any 401 after that as expected rather than as an error. |


### 3.1 Rev 4: MCP consent authorization finalization (replaces B3 for MCP consent)
**Guarantee:** an incomplete MCP consent operation associated with a revoked Aura session never becomes a usable authorization, even if its OAuth grant write commits after logout. Legitimately completed authorizations survive ordinary logout; logout does not revoke MCP connections.
- **Authoritative state:** `McpConsentFinalization` in the **Aura** database (migration 0057). A row binds a grant to its exact account, client and complete authorization. The MCP OAuth database stays separate and its schema is unchanged.
- **Linearization point:** the COMMIT of one conditional insert that selects the approving `AuthSession` row `FOR SHARE`. That row must not be revoked, must not be expired by the database clock, and must be the row the token was issued for. If logout commits first, the insert writes no row.
- **Enforcement:** the OAuth store's `Grant` model returns a grant only with a covering finalization. That is the single point used by consent resume and code issuance, code redemption, refresh, MCP resource access and connection listing (oidc-provider 9.13.3, pinned).
- **Consent flow:** every consent creates a new grant (no reuse). The interaction is finished only after a confirmed finalization; an ambiguous COMMIT finishes nothing.
- **Outages:** an Aura-database outage fails closed with 503 and revokes nothing.
- **Deadline (F2):** one 2 000 ms consent budget, starting before session verification, covers acquisition, the grant save, finalization and completion. Finalization is not attempted with less than 300 ms remaining.
- **No dependence on:** compensating revocation, connection liveness or timeout ordering.

---

## 4. D3 revised: permanent invalidation of legacy sessions

### 4.1 Where a v1 token could become valid again
A v1 (`as_session`) token is accepted anywhere that runs **code from before cutover with the old `AUTH_SECRET`**. There are three such places:

| # | Exposure | Fixed by code alone? |
|---|---|---|
| X1 | New code (I2 and later) | **Yes.** It never reads `as_session` for authentication, the v2 verifier rejects v1 tokens, and the key differs. |
| X2 | **A rebuild of any commit from before cutover**, for example a revert PR or "redeploy" of an old commit, using the *current* Production env | **No.** The old code verifies with whatever `AUTH_SECRET` is in the env. |
| X3 | **Existing deployments from before cutover**, through Vercel instant rollback or their unique deployment URL | **No.** A Vercel deployment keeps the env values it was built with, so rotating the secret later doesn't reach it. |

### 4.2 Cutover runbook (D3 safeguards)
Everything below is **owner-run at the cutover release, under that release's own authorization**. None of it is authorized now. The steps run in order, and each gate must pass before the next step.

**Step A: Inventory (read-only).** Record the following in the release record. Record variable **names and scopes only, never values**.
- Every Production deployment, including its unique `*.vercel.app` URL and any aliases.
- Every Preview deployment and branch alias.
- Every other Vercel project or environment that can reach the Production database, such as the staging project ids listed in `mcpAuthGate`.
- For each environment, whether `AUTH_SECRET` is the **same variable entry** as Production, and which database host it uses.

**Gate A:** No non-Production environment may share **both** the Production `AUTH_SECRET` and the Production database. If one does, its deployments built before cutover join the set retired in Step F. That environment's secret is also separated before Step C, under separate authorization.

**Step B: Capture test cookies.**
- On the current Production deployment (REL-05), sign in with a dedicated test account and keep its `as_session` value as **C-old**.
- Keep it only for this test, and record that it has been destroyed once the cutover is complete.

**Step C: Rotate `AUTH_SECRET` in the Production env.**
- This closes X2: no future build of any commit verifies a token signed before cutover.
- The running deployment is unaffected, because it keeps the env it was built with.

**Step D: Build both candidates with the new env**, and promote neither.

**R1** is the cutover build. On its unique URL it must:
- reject C-old: `/api/auth/session` answers `{user:null}`, and an authenticated API call returns 401;
- issue and verify a v2 session;
- after logout, return 401 for a replayed v2 cookie;
- reject a v1 cookie that the same test account obtained by signing in on R0-safe (see the R0-safe checks below), even though that cookie is signed with the **new** secret.

**R0-safe** is the REL-05 commit rebuilt unchanged. On its unique URL it must:
- reject C-old;
- ignore the v2 cookie (`__Host-as_sid` / `as_sid`);
- complete a normal sign-in and pass the REL-05 core smoke tests, so it is a working rollback candidate;
- build cleanly against a database that already has migration 0055 applied (`prisma migrate deploy` must not fail on a newer applied migration);
- return 401 for C-old on the authenticated routes that never load the user row.

**Gate D:** every R1 and R0-safe check passes. **No deployment is retired before Gate D.**

**Step E: Promote R1** and run the post-promotion smoke tests on the production domain, including the C-old rejection.

**Step F: Retire historical access.**
- Delete every Production deployment built before cutover, plus any Preview or other deployments that Gate A flagged.
- Record ids, commits and build metadata first.
- Deployment Protection alone is not enough, because instant rollback and the unique URL would remain.

**Gate F:**
- Each retired unique URL returns 404.
- The deployment list shows only R1, R0-safe and later Production deployments.
- C-old is rejected on the production domain, R1's URL and R0-safe's URL.

**Direct deployment URLs:** only R1, R0-safe and later builds remain reachable, and all of them reject C-old. Cookie scoping is **not** relied on, because an attacker can send any `Cookie` header to any URL.

### 4.3 Rollback policy after cutover
- **Allowed rollback targets:** R1, later revocation-aware releases, and **R0-safe**. Nothing else.
- **R0-safe** rejects every cookie issued before cutover, because it uses the new key, and it never reads the v2 cookie, so revoked v2 sessions stay dead.
- **Sessions issued during an emergency rollback cannot bypass revocation afterwards:**
  1. **While R0-safe is live**, users sign in again and receive v1 tokens signed with the new secret. Logout on R0-safe only clears the cookie. This is the accepted emergency limitation, so keep R0-safe live for as short a time as possible.
  2. **On rolling forward** to R1 or a fix, those tokens are rejected by construction: R1 never authenticates `as_session`, v2 requires `typ`/`v` and the HKDF key, and R1 clears `as_session`. An I2 test asserts this: a v1 token signed with the **current** secret is rejected.
  3. **R0-safe is single-use.** Once it has been promoted, the roll-forward includes, under its own authorization:
     - rotating `AUTH_SECRET` again;
     - deleting the used R0-safe;
     - building and verifying a fresh R0-safe with the Step D checks.

     After that, no deployment and no future build can verify the tokens issued during the rollback.
  4. The `AuthSession` table is untouched by REL-05 code, so every revocation recorded before the rollback is still enforced after rolling forward.
- **No "disable enforcement" switch exists.** The table is never dropped, and dropping it would only sign everyone out, which fails closed.
- **Fixing forward is preferred.** R0-safe is only for an emergency.
- **Current rollback targets** REL-03 `dpl_EhhkW` and REL-04 `dpl_3Sst` are deleted in Step F. The owner has acknowledged this as part of D3.

**Result:** no session invalidated at cutover, and no session issued during an emergency rollback, can become valid again. That holds across new code, rebuilds of old commits, existing or direct deployment URLs, Preview environments and historical deployments, provided Gates A, D and F pass.

### 4.4 Effect of rotating `AUTH_SECRET` on the other token types sharing the key

| Token or use (all `AUTH_SECRET`) | Lifetime | Effect at the instant of rotation | User impact |
|---|---|---|---|
| v1 session `as_session` | 30 d | Invalid (intended) | Signs in once (D2) |
| Sign-in code hash (`AuthCode`, `hashAuthCode`) | 15 min | Pending codes stop matching | "Request a new code" (existing message) |
| Magic-link token | 15 min | Invalid | **None in Prod**: disabled outside local dev (AUTH-02) |
| Guest-state token (`lib/guestState.ts`, `/find` restore) | 30 min | Invalid | A guest repeats one search |
| Day Constructor preview acceptance token | In-page | Accept rejected by the existing integrity check | Re-preview |
| Remaining-day recomposition token | No TTL, bound to the day | Rejected by the existing check | Re-run "recompose" |
| `emailLogRef` log pseudonym | n/a | References change | Log correlation breaks at the cutover instant. Note it in the release record. |
| MCP local gate (`mcpAuthGate`) | n/a | Checks the strength of `AUTH_SECRET` only. MCP OAuth state is separate, and Production is `reject_all`. | None |
| Aura Moment share tokens, push, reminder dispatch, internal metrics | n/a | Use their own secrets or random tokens, not `AUTH_SECRET` | None |
| Native Android and iOS shells | n/a | Store no tokens | None beyond signing in again |

Rotating at a low-traffic hour limits the impact to a few in-flight codes and searches. Giving each non-session token type its own derived key would let a future rotation be scoped. That is useful hygiene but **out of scope** here.

---

## 5. Cookie security and server-side expiry (verified)

**Current cookie on `main`, checked in `verify-code/route.ts:83` and `verify/route.ts:36`:**
- `HttpOnly`;
- `Secure` only when `NODE_ENV==='production'` (Vercel Production and Preview runtimes run as production);
- `SameSite=Lax`, `Path=/`, no `Domain` (host-only);
- `Max-Age` 30 d.

Logout clears it with `Path=/` and `Max-Age=0`. Expiry is checked **only against the token's `exp` using the app clock**; there is no server record. These are static code checks. Device behaviour is verified in the I2 staging step.

| Attribute | v2 |
|---|---|
| Name | **`__Host-as_sid`** whenever Secure (Vercel). `as_sid` only for local http dev, including the Android emulator with cleartext. One helper chooses the name. |
| HttpOnly / SameSite / Path / Domain | `HttpOnly` · `Lax`: blocks cross-site POST, keeps top-level navigation from email working · `/` · none. The `__Host-` prefix requires `Secure`, `Path=/` and no `Domain`, so the browser enforces these. |
| Max-Age | Computed from the row's DB-set `expiresAt`. It is a client hint only. |
| Clearing | Same name, `Secure` and `Path=/`, otherwise the browser ignores the deletion of a `__Host-` cookie. Clears `as_sid`/`__Host-as_sid` **and** legacy `as_session`. Tested. |

**Server-side expiry is independent of the cookie.** `expiresAt` is set by the database (`now() + make_interval(hours => 720)`, R1: 720 **elapsed** hours, independent of the session TimeZone; a days interval would give 719 / 721 h across a DST change) and checked in the lookup SQL against the database's `now()`. The token's `exp` is a second, app-clock check copied from the same value. Both must pass, so clock skew can only make the check stricter. A cookie that is kept past its `Max-Age`, or edited, is still rejected.

---

## 6. Review of the uncommitted REL-02-A1/A2 work

**Inventory:**
- Five worktrees (`s2-durable-signout`, `s4-signout-state`, `s4-1-navigation-signout`, `s4-2-shared-signin-guard`, `hpg2-goal-linked-plans`), all based on `9d6b77d` (2026-11-11), uncommitted and never reviewed.
- The backend files are **byte-identical** in all copies (`session.ts`, `accountDeletion*.ts`, tests).
- `sessionCookieNative.ts` differs: the s4 copy (2026-11-18) is newer than s2 and is the canonical one.
- **No remote branch** contains `SessionCookiePlugin.java`, so no shipped or REL-04 Android build depends on it.

| Item | Verdict | Reuse |
|---|---|---|
| A2 `SessionVerificationUnavailableError`, plus the rule that an outage never reads as "signed out" | Sound | **Reuse in I1** (same class name and contract) |
| A2 "user still exists" lookup (`getUserById`, `SELECT *`) | Replaced by the `AuthSession` lookup | Do not reuse |
| A2 `sessionLiveCheckCoverage` static scanner (rules R1–R4 plus negative fixtures) | Good approach | **Reuse in I2.** Extend it to the new cookie names, E2 server pages and E4 MCP consent. |
| A2 throws without a 503 mapping in the 76 routes, so the result would be HTTP 500 | Gap | I2 maps it centrally (`withSession`) |
| A1 `deleteUserAccount` (`FOR UPDATE` on `User`, explicit RESTRICT deletes, verification inside the transaction, SQLSTATE-only errors) | Sound design | Reuse in step 3. The **table lists are stale**: written against 51 migrations, while `main` is at 0054. Re-derive them, add `AuthSession`, and add the B3 re-check. |
| A3 deletion API (same-origin and JSON content-type checks, code claim and release) | Sound | Step 3. Validates the session outside the deletion transaction, so add B3. |
| S2/S4 native plugin (versioned contract, capability check for old shells) | Good pattern | Before it ships: delete the cookie names passed from JS, or all three names, and bump the contract version. With server-side revocation, a cookie that comes back after a kill is already dead, so the plugin becomes defence in depth. |

Nothing from this work is copied into I1 except the error contract.

---

## 7. Accepted decisions D4, D7, D8

| # | Accepted |
|---|---|
| **D4** | **Fixed 30-day expiry, set and enforced by the server** (`expiresAt` set by the DB and checked in SQL). No sliding renewal, no idle timeout, no `lastSeenAt`. |
| **D7** | **Sign-out-everywhere backend only.** `revokeAllSessionsForUser` arrives dormant in I1, and account deletion is its first caller. No UI or device list. |
| **D8** | **Revocation is saved durably before logout reports success.** If the outcome is unknown, logout returns 503, keeps the cookie, retries once automatically, then shows "Couldn't sign out. Try again." **There is no local-only logout fallback**, and the Android durable cookie removal runs only after a 200. |

---

## 8. Measured overhead

The benchmark ran on a throwaway local PostgreSQL 16 cluster in the scratchpad (127.0.0.1, loopback), with 10 k users and 100 k sessions. It used `pg` Pool defaults, the same as `lib/db.ts`: max 10, `connectionTimeoutMillis` 0. Script and raw output are in `AURA_AUTH_SESSION_01_EVIDENCE/`.

| Measure (4 000 iterations) | p50 | p95 | p99 |
|---|---|---|---|
| Today: `getUserById` | 0.116 ms | 0.353 ms | 0.869 ms |
| Session lookup alone (PK index scan, 4 buffer hits, 0.007 ms execution) | 0.082 ms | 0.237 ms | 0.389 ms |
| Lookup + `getUserById` (2 round trips) | 0.147 ms | 0.338 ms | 0.614 ms |
| Joined session + user (1 round trip) | 0.113 ms | 0.154 ms | 0.240 ms |

| Pool (max 10), 50 concurrent | p50 | p95 | Throughput |
|---|---|---|---|
| Today (1 query) | 1.53 ms | 2.47 ms | 30.6 k/s |
| Naive (2 queries) | 2.58 ms | 5.02 ms | **17.1 k/s (−44 %)** |
| Joined (1 query) | 1.77 ms | 2.34 ms | 27.8 k/s (−9 %) |

Other costs:
- Token CPU: verify + parse + sha256 takes 17 µs. `randomBytes(32)` takes 1.2 µs.
- Cleanup: a batch of 5 000 rows took 9.3 ms.

**What the numbers mean:**
- The query itself costs almost nothing. **Round trips and the time a pool connection is held** are what matter.
- On Neon, each extra round trip adds about one network RTT, and it doubles how long a connection from the 10-slot pool is held. Neon was **not measured** because Production access is not authorized.
- I2 therefore uses the **joined query** in the 42 routes that already load the user, which adds 0 round trips, and the lookup alone in the other 34, which adds 1.
- **Fail-closed gap found:** `lib/db.ts` sets no connection, statement or lock timeout, so a stalled database or an exhausted pool makes the session check *hang* rather than fail. §8.1 fixes this for session operations only. The shared global pool is not changed.
- I2 staging acceptance measures the real Neon p95 for authenticated routes before and after.

### 8.1 Database-enforced lookup bounds
The 2-second budget must bound **work on the database server**, not just how long JavaScript waits. A Promise timeout alone leaves the query running on the server and the connection checked out. Session operations therefore use their own small pool, `aura-session`, which is created by a factory in I1 and stays dormant until I2. They are bounded in three layers.

| Layer | Mechanism | Bound | What it frees |
|---|---|---|---|
| **L1 Acquire** | Dedicated pool `{max: 5, connectionTimeoutMillis: 500, idleTimeoutMillis: 10 000, application_name: 'aura-session'}` | ≤ 500 ms to get or open a connection | No unbounded queue. A session check is never stuck behind slow application queries on the shared pool. |
| **L2 Server** | **One simple-query message:** `BEGIN; SET LOCAL statement_timeout='1000ms'; SET LOCAL lock_timeout='250ms'; SELECT …; COMMIT` | PostgreSQL itself cancels the statement after 1 000 ms, or after 250 ms waiting on a lock (SQLSTATE 57014 / 55P03) | **Server backend CPU, locks and snapshot.** This works through a transaction-mode pooler, because the settings are transaction-local, and it is a single round trip. |
| **L3 Client** | A single absolute deadline covers acquire, send and result, 2 000 ms in total. When it passes, the client is **discarded with `release(err)`**, never returned to the pool. | ≤ 2 000 ms to the caller | **The connection.** The server-side work is already bounded by L2. A late result is never used. |

**Inlined values are safe.** The single message uses the simple query protocol, so the lookup values are inlined. Before inlining, both are checked against strict patterns: `idHash` must be exactly 43 base64url characters and `userId` must be a UUID. They are then escaped with `pg`'s `escapeLiteral`. The timeout values are integer constants. Nothing from the request reaches the SQL without passing those checks.

**Failures:**
- Every failure (L1, L2 or L3, driver or socket errors, an unexpected result shape) raises `SessionVerificationUnavailableError`, which becomes a 503. It never becomes 401 or 200.
- A connection that has errored is discarded.
- The pool's `error` handler records the error class only and never crashes the process.
- The design follows the MCP I2b deadline pattern (`packages/mcp-tools/src/security/deadline.ts`), reimplemented as about 60 lines and not imported, so the session code stays separate from MCP.

**Writes are bounded the same way.** Revoke, revoke-all, create and cleanup use the same `BEGIN; SET LOCAL …` prefix and the same deadline. Cleanup gets a larger `statement_timeout` (5 000 ms) and keeps its `LIMIT`.

**R1 clarified budgets (39233). These are maxima, not cumulative allowances.** Every phase is also limited by what **remains** of one absolute, monotonic caller deadline. The acquisition wait and the `SET LOCAL statement_timeout` / `lock_timeout` values are each `min(maximum, remaining)`.

| Operation | Pool acquisition | Lock timeout | Statement timeout | Overall caller deadline |
|---|---|---|---|---|
| Lookup | 500 ms | 250 ms | 1 000 ms | 2 000 ms |
| Foreground write (create, revoke) | 500 ms | 1 000 ms | 1 500 ms | 2 000 ms |
| Background cleanup (never on an interactive path) | 500 ms | 1 000 ms | 5 000 ms | 6 000 ms |

**Outcome classes:**
- **Confirmed success.**
- **Confirmed failure:** the statement was never sent; or PostgreSQL rejected it before COMMIT with a statement timeout (57014), lock timeout (55P03), a constraint violation (class 23) or SQLSTATE class 22 / 25 / 40 / 42 / 0A.
- **Uncertain:** the statement was sent and its result is unknown, because the deadline passed, the socket was lost, or there was a connection or operator error.

**Retry rules:**
- `revokeAuthSession` retries **only an uncertain outcome**, at most once, and only if at least 300 ms of the **same** deadline remains. A retry never restarts or extends the deadline.
- Lookups and creates are never retried.
- The dedicated pool stays at five connections.

**Recovery:**
- Discarded or terminated connections are replaced on demand.
- After the database restarts or a backend is terminated, the next lookup either succeeds or returns one `unavailable`. It is never treated as authenticated, and it recovers without restarting the process.

**Connections:** 5 more per instance for the session pool. This must be checked against the Neon pooler and connection limits in I2 staging, which is the same verification item as MCP V2.

**Verification:** the I1 database tests listed in the ticket (T1–T8) check, through `pg_stat_activity`, that **no server backend from `aura-session` stays active or waiting** after each bound fires. That confirms the resource bound on the server, not just the client error.

---

## 9. Web, Android and iOS compatibility

- **Web:** cookie rename. The session bootstrap must treat 503 from `/api/auth/session` as "unknown", not "signed out" (I2 client change). Every user signs in once.
- **Android** (Capacitor, `minWebViewVersion` 91, hosted `server.url`): every installed shell works unchanged, including shells built before the plugin, because the server owns the session and the web code is served live. Chromium WebView 91 and later supports `__Host-` and `SameSite`. Emulator and local dev over http use the unprefixed name, as today. The only native item is the REL-02 plugin's cookie names, before that plugin ships.
- **iOS** (WKWebView, hosted URL): no native session code. Setting, clearing and keeping the `__Host-` cookie across an app kill is **verified on a device** in I2 staging. That is a test step, not a known risk.
- **Unaffected:** the MCP OAuth bearer tokens and their store. Only the consent screen's user check (E4) moves to `lib/session.ts` (D6).

### 9.1 Native verification at the integration stage (I2 staging, required)
**Supported floors:** Android `minSdkVersion` 29 with WebView ≥ 91, and iOS deployment target 13.0.

**Devices:**
- Android: the lowest supported WebView or OS available, plus a current device.
- iOS: the lowest supported iOS available, plus a current device.
- Emulators and simulators supplement physical devices but don't replace them.
- If a floor device isn't available, record it as a gap for the owner rather than assuming it passes.

| # | Case | Pass |
|---|---|---|
| N1 | Sign in, force-stop, restart (and reboot once) | Still signed in. The `__Host-as_sid` cookie persists. |
| N2 | Log out, then immediately force-stop and restart | Signed out. The server row is revoked and the cookie is absent after restart. On Android this is the durable flush. |
| N3 | Replay a cookie copied before logout (with a proxy or curl) | 401 |
| N4 | Server-side expiry: set the test session's `expiresAt` in the past (an authorized staging DB operation) | The next request gets 401, followed by a clean sign-in prompt and no loop |
| N5 | Sign in again after expiry or logout | A new session works and the old one stays rejected |
| N6 | Cutover: a shell holding a legacy `as_session` opens the app | Treated as signed out. `as_session` is cleared and sign-in works. |
| N7 | Offline, and a staging lookup that is unavailable (503) | No sign-out and no local state lost. Recovers when the service returns. |
| N8 | A shell build from before the cutover, upgraded to the current build | Same results as N1–N7 |

---

---

## 10. Implementation sequence

| Step | Content | Gate |
|---|---|---|
| **I1** | Session table migration, token primitives, store primitives, focused tests. **Not wired into anything.** See the ticket. | REL-05 cut + explicit authorization |
| **I2** | Cutover PR: issuance, logout, `lib/session.ts` on the bounded `aura-session` pool (§8.1), E1–E5 (E4 per D6), B3 re-checks, cleanup in the daily cron, client 503 and logout handling, extended coverage test, removal of v1 session code. Includes a test that a v1 token signed with the **current** secret is rejected. | Owner review |
| **I2-S** | Staging integration: native matrix §9.1 (N1–N8), Neon pooler and connection check for the session pool, real p50/p95 before and after | Owner |
| **R** | Cutover release, owner-run per the §4.2 runbook: Steps A–F with Gates A, D and F, including verifying R0-safe **before** any retirement | Owner, separate release after REL-05, under its own authorization |
| **3** | Account deletion (re-derived A1/A3 plus revoke-all and B3), Android plugin update, then the D7 UI | Separate tickets |

**Migration number:** **0055 is the next free number** as of `origin/main` `3feff03`. The latest is `0054_reminder_dispatch_heartbeat`; no remote branch, open PR or local worktree has 0055 or above, including `aura-mp-01`. At the start of I1:
- take `max(origin/main) + 1`;
- **coordinate with My People MP-1**, which is also expected to add a migration: whichever PR merges first keeps the number, and the other renumbers before its merge;
- check again immediately before merge.

**Docs:** this design, the I1 ticket and `AURA_AUTH_SESSION_01_EVIDENCE/` stay in the `auth-session-01` worktree and are **committed in the I1 PR**. There is no separate documentation-only PR.
