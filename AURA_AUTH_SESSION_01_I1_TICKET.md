# AURA-AUTH-SESSION-01-I1 — Session Store Foundation (dormant)

**Status:** READY, **ON HOLD**. Starts only after the REL-05 cut **and** explicit implementation authorization.
**Design:** `AURA_AUTH_SESSION_01_REVOCATION_DESIGN.md` Rev 3 (final, design ticket closed). See §2, §3 (B3), §5, §8 and §8.1.
**Where:** the existing `.claude/worktrees/auth-session-01` worktree, which holds this ticket, the design and `AURA_AUTH_SESSION_01_EVIDENCE/`. At start, rebase onto the then-current `origin/main` and rename the branch to `feature/aura-auth-session-01-i1`. **The I1 PR commits the design, this ticket and the evidence together with the code.** There is no separate documentation-only PR.
**Merge:** independent of I2, after implementation, verification and **separate merge approval**.

## Goal
Add the server-side session table, the token primitives and the bounded store primitives, with focused tests. The work must meet these hard constraints:
- **No change to existing authentication behaviour.** `lib/auth.ts`, `lib/session.ts`, every route, page and component, every cookie, and the token issued today all stay exactly as they are.
- **No Production dependency on the new signing key.** No new module reads `AUTH_SECRET` or any environment variable. The key is derived only from a secret passed in by the caller, and nothing in I1 does that outside tests. There is no new env var and no work at import time: no pool is created and no key is derived when a module loads.
- **Dormant.** No application code imports the new modules, and a static guard test enforces this.

## Preconditions at start
1. REL-05 is cut and implementation is explicitly authorized.
2. **Migration number:**
   - Take `max(origin/main migrations) + 1`. It was 0055 on 2026-11-26, but REL-05 may add one.
   - **Coordinate with My People MP-1**, which also expects a migration. Check MP-1's PR or worktree and agree the order. Whichever merges first keeps the number, and the other renumbers.
   - Check open PRs, then check again immediately before merge.
3. Stay clear of active workstreams: Android R8 (#392), Palmistry (#396), My People, MCP (#397 and others), PREF-01 (#393).
   - MCP's `deadline.ts` pattern is **reimplemented** here, not imported or modified.
   - The only shared file is `.github/workflows/ci.yml`, which gets the added test steps only.

## In scope

**1. Migration `00NN_auth_session/migration.sql`.**
- Additive only: the `AuthSession` table with its 2 indexes and CHECKs, exactly as in design §2.1.
- Add the matching `AuthSession` model to `prisma/schema.prisma`, with a back-relation on `User`.
- It runs **only** on CI and local test databases, through the existing `prisma migrate deploy` step.
- It may later reach Production through a subsequent **authorized** release, where it is an empty, unused table.

**2. `apps/web/lib/authSessionToken.ts`.** Pure functions, `node:crypto` only, no new dependency, no env reads.

| Function | Purpose |
|---|---|
| `generateSessionId()` | 32 random bytes, base64url (43 characters) |
| `hashSessionId(sid)` | base64url SHA-256 |
| `deriveSessionKey(secret)` | HKDF-SHA256, salt `aura.session`, info `aura-session-v2`, 32 bytes. Rejects a secret shorter than 32 characters. |
| `createSessionTokenV2(key, {sid, uid, iat, exp})` | Builds a v2 token |
| `verifySessionTokenV2(key, token, now?)` | The strict verifier from §2.2. Returns `{sid, uid, exp}` or `null`. |
| `sessionCookieName(secure)` | `__Host-as_sid` or `as_sid` |
| `sessionCookieOptions(expiresAt, secure, now?)` | Attributes for issuing the cookie |
| `sessionCookieClearOptions(secure)` | Attributes for clearing `__Host-as_sid` / `as_sid` and the legacy `as_session` |

**3. `apps/web/lib/authSessionDb.ts`.** Bounded execution per §8.1.
- `createSessionPool(connectionString)` is a factory and is never called at import. It returns a pool with `max: 5`, `connectionTimeoutMillis: 500`, `idleTimeoutMillis: 10 000` and `application_name: 'aura-session'`, plus an `error` handler that records the error class only.
- `boundedSessionQuery(pool, sql, {statementTimeoutMs, lockTimeoutMs, deadlineMs})` works as follows:
  - It sends **one** simple-query message: `BEGIN; SET LOCAL statement_timeout; SET LOCAL lock_timeout; <statement>; COMMIT`.
  - One absolute deadline covers checkout, send and result.
  - When the deadline passes, the client is discarded with `release(err)`. A late result is never used.
  - Every failure is mapped to `SessionVerificationUnavailableError`.
  - The timeout values must be integers within fixed ranges.
- `literal(value, kind)` checks the value against a strict pattern (`idHash`: 43 base64url characters; `userId`: UUID; `reason`: one of the allowed values), then applies `escapeLiteral`. Anything else throws before any SQL is built.
- **Budgets (R1, 39233), maxima per operation, each phase also limited by the remaining caller deadline:**
  - lookup: acquire 500 / lock 250 / statement 1 000 / deadline 2 000 ms;
  - foreground write: 500 / 1 000 / 1 500 / 2 000 ms;
  - background cleanup: 500 / 1 000 / 5 000 / 6 000 ms.

  `revokeAuthSession` retries only an **uncertain** outcome, once, within the same deadline, and only if ≥ 300 ms remain.

**4. `apps/web/lib/authSessionStore.ts`.** Built on (3).

| Function | Contract |
|---|---|
| `createAuthSession(pool, userId)` | INSERT … RETURNING `expiresAt`, set by the DB as `now() + make_interval(hours => 720)` (R1). Returns a `CommittedAuthSession`. |
| `createAuthSessionInTransaction(client, userId)` (R1) | INSERT inside the **caller's** transaction. Returns a `ProvisionalAuthSession`, which has no `sid`. The helper never sends BEGIN / COMMIT / ROLLBACK / SET. |
| `commitAuthSessionTransaction(client, provisional)` (R2, 39235) | The caller invokes it **as** its COMMIT. It first checks, inside the caller's transaction, that the transaction is still open and holds the row; then it sends COMMIT and classifies the caller's commit as `committed` (acknowledged; carries a `CommitAuthorization`), `rolled_back` (confirmed) or `ambiguous`. For anything but `committed`, the raw id is destroyed. |
| `releaseCommittedAuthSession(pool, authorization)` (R2) | **Confirmed commit only.** It reads the row back on an independent connection and returns a `CommittedAuthSession` (with the raw id) only for a live, matching row. Missing, expired, revoked or mismatched rows give null. It releases at most once. |
| `classifyAmbiguousCommit(pool, provisional)` (R2) | After an **ambiguous** commit only. Returns `committed_undisclosed` or `not_committed` and **never** session material. **No cookie may ever be issued after an ambiguous commit**, whatever the read-back finds. |
| `lookupAuthSession(pool, idHash, userId)` | Returns `{userId}` or `null`. Any failure throws the unavailable error. |
| `lookupAuthSessionWithUser(pool, idHash, userId)` | The joined variant, same contract |
| `revokeAuthSession(pool, idHash, reason)` | Idempotent. Returns `'revoked'` or `'already_inactive'`. One retry if the outcome is ambiguous, then throws. |
| `revokeAllSessionsForUser(client, userId, reason)` | Returns the count. Runs in the caller's transaction. |
| `recheckAuthSessionForShare(client, idHash, userId)` | `FOR SHARE` in the caller's transaction (B3) |
| `cleanupAuthSessions(pool, {limit = 5000, graceDays = 7})` | Returns the count deleted |

**5. `apps/web/lib/sessionErrors.ts`.** `SessionVerificationUnavailableError`, with a fixed message and no id, email, token or SQL. It carries a diagnostic `cause` limited to `acquire`, `statement_timeout`, `lock_timeout`, `deadline`, `driver` or `shape`. The contract comes from REL-02-A2.

## Tests

**`test/authSessionToken.test.ts`** (no database)
- **Round-trip:** create then verify. `sid` is 43 base64url characters, and 1 000 generated ids are unique.
- **Rejects other formats:** v1 session, magic-link, guest-state, preview and recomposition tokens, each signed with the same base secret. The reverse also holds: the legacy `verify()` rejects a v2 token.
- **Rejects bad values:** wrong `typ` or `v`, a malformed `sid` or `uid`, an expired token, `iat` more than 60 s in the future, a tampered body or signature, a key from a different secret, and a secret shorter than 32 characters.
- **Cookie helpers:** the `__Host-` name only when Secure. `HttpOnly`, `SameSite=Lax`, `Path=/`, no `Domain`, and `Max-Age` taken from `expiresAt`. Clearing covers all three names with matching `Secure` and `Path`.
- **`literal()`:** rejects every malformed input, including quotes, backslashes, NUL, overlong values and a non-UUID, before any SQL is built.

**`test/authSessionStoreDb.test.ts`** (CI Postgres, `db-migration-validation` job)
- **Lifecycle:** create, look up, revoke, then the lookup returns `null`. Revoking again returns `'already_inactive'`. A wrong `userId` returns `null`.
- **Expiry:** a row with `expiresAt` in the past returns `null`, even when the token would still pass. `expiresAt` is set by the DB.
- **Revoke-all** affects only one user's sessions. **Cascade:** `DELETE "User"` removes that user's sessions.
- **Cleanup** removes only rows past the grace period, never live rows, and respects the limit.
- **Privacy:** the raw `sid` is never stored.
- **B3 ordering:** a transaction holding `recheckAuthSessionForShare` blocks `revokeAuthSession` until it commits. If the revoke commits first, the recheck returns `null`.

**Bound tests.** Each checks the server side through `pg_stat_activity` filtered on `application_name = 'aura-session'`.

| # | Case | Pass |
|---|---|---|
| T1 | Lock bound: another session holds `ACCESS EXCLUSIVE` on `"AuthSession"` | The lookup fails with cause `lock_timeout` in about 250 ms. No `aura-session` backend is left waiting. |
| T2 | Statement bound: the same wrapper runs `SELECT pg_sleep(5)` through a test-only seam | Cause `statement_timeout` in about 1 000 ms. The backend is idle afterwards and does not keep sleeping. |
| T3 | Client deadline shorter than the server bound (deadline 200 ms, statement 1 000 ms, `pg_sleep`) | The caller gets `deadline` in about 200 ms. The client is **discarded** (`totalCount` drops). The backend's statement ends within the server bound. |
| T4 | Acquisition: all 5 pool clients held | `acquire` in about 500 ms. `waitingCount` returns to 0 and nothing stays queued. |
| T5 | Recovery: `pg_terminate_backend` on every `aura-session` backend | The next lookup either succeeds or fails `unavailable`; it is never treated as authenticated. The following lookups succeed without a restart. No uncaught `error` events (process listener). |
| T6 | Ended pool / driver error | `unavailable` with cause `driver`. The message contains no id, token or SQL. |
| T7 | Resource budget: 50 concurrent lookups while T1's lock is held | All fail within the deadline. At most 5 `aura-session` backends at any moment. All idle when the lock is released. |
| T8 | Normal-path check: 1 000 lookups | The p95 is recorded in the test output, as a smoke comparison with the evidence in §8. |

**`test/authSessionDormancy.test.ts`** (static)
- Fails if anything in `app/`, `pages/` or `components/`, or in `lib/` outside the four new modules, imports any of them.
- Fails if any new module reads `process.env` or creates a pool or key at the top level.
- I2 removes the guard.

**CI:** add these tests to `ci.yml`. The static and unit tests go in the existing unit job, and the database test goes in `db-migration-validation`. Nothing else in `ci.yml` changes.

## Out of scope
- Routes, pages, cookie issuance, `lib/auth.ts`, `lib/session.ts`, logout, clients and cron. These all belong to I2.
- Account deletion, MCP code (D6 lands in I2), and the Android plugin.
- Credential rotation, Vercel or Production access, migration execution outside CI and local test databases, deployment, deleting deployments, and releasing.

## Acceptance
- CI is fully green: `prisma migrate status` is clean and the new tests pass.
- The existing tests for sign-in, logout and the session route pass **unchanged**.
- The diff contains only the following:
  - the migration and `schema.prisma`;
  - the 5 new `lib/` files;
  - the 3 new tests;
  - the `ci.yml` steps;
  - the design, this ticket and the evidence directory.
- The dormancy guard passes. `git diff origin/main -- apps/web/lib/auth.ts apps/web/lib/session.ts apps/web/app` is empty.
- Verification is recorded in the PR: test output for T1–T8 and the migration number check, including the MP-1 coordination.

**Size:** small to medium. About 600–800 lines including tests, in a single PR.
