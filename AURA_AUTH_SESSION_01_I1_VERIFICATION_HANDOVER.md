# AURA-AUTH-SESSION-01-I1 — Implementation and Independent Verification Handover

**Date:** 2026-11-27 · **Ticket:** 39230 / AURA-AUTH-SESSION-01-I1 (`AURA_AUTH_SESSION_01_I1_TICKET.md`) · **Design:** `AURA_AUTH_SESSION_01_REVOCATION_DESIGN.md` Rev 3
**Branch:** `feature/aura-auth-session-01-i1`, worktree `.claude/worktrees/auth-session-01`. **Draft PR [#401](https://github.com/ste277/aura-updated/pull/401)**, base `main` = `477723d` (integration base, unchanged at push). Head `29bf09d` = approved implementation `5d8a16c` + one evidence-hygiene commit. Auto-merge OFF, auto-fix OFF. No merge, no deploy.
**Status:** READY FOR INDEPENDENT VERIFICATION. CI results are in §10. Merge requires separate approval.

---

## 1. What I1 is

I1 adds a dormant foundation for server-side sessions:
- the `AuthSession` table (migration **0055**);
- v2 token and cookie primitives;
- a pool and query runner whose time limits are enforced by the database;
- the store operations.

**Nothing in the application uses any of it.** Sign-in, logout, the `as_session` cookie, `lib/auth.ts`, `lib/session.ts`, every route, page and component, and both `package.json`s are byte-identical to `main`. This is verified by `git diff origin/main` (§6, check V1).

## 2. Migration number: 0055 reserved for AUTH-SESSION I1

| Check (2026-11-27) | Result |
|---|---|
| Latest on `origin/main` (`477723d`) | `0054_reminder_dispatch_heartbeat` |
| `0055`+ on any remote branch | none |
| Open PRs (#392, #370, #344) | none add a migration ≥ 0055 |
| Local worktrees | none, except this branch |
| **My People MP-1** (`aura-mp-01`, untracked ticket) | **Its ticket names `0055_my_people_foundation`.** It also says "confirm the next free number on `main` at start". |

**Decision, per the owner:** `0055_auth_session` belongs to AUTH-SESSION I1. **MP-1 must use 0056**, or the next free number when MP-1 starts. I did not touch the MP-1 files. Whoever starts MP-1 should change its ticket and migration directory to 0056. If MP-1 somehow merges first, I1 renumbers before its own merge. Recheck immediately before merging I1.

## 3. Files

| File | Purpose |
|---|---|
| `apps/web/prisma/migrations/0055_auth_session/migration.sql` | One table, two indexes and four CHECK constraints. Additive only; no backfill. |
| `apps/web/prisma/schema.prisma` | `AuthSession` model plus the `User.authSessions` back-relation. These are Prisma relation fields only, with no column change. |
| `apps/web/lib/sessionErrors.ts` | `SessionVerificationUnavailableError`: a fixed message plus a `reason`. This is the REL-02-A2 contract. |
| `apps/web/lib/authSessionToken.ts` | Session id and hash, HKDF key, v2 create and strict verify, cookie names, options and clear list |
| `apps/web/lib/authSessionDb.ts` | Dedicated `aura-session` pool factory, `boundedSessionQuery` (L1–L3), `sqlLiteral` and `sqlInteger` |
| `apps/web/lib/authSessionStore.ts` | Create (standalone and inside a caller's transaction), lookup and joined lookup, revoke, revoke-all, B3 FOR SHARE re-check, cleanup |
| `test/authSessionToken.test.ts` | 67 checks, no database |
| `test/authSessionStoreDb.test.ts` | 50 checks: the Part 1 functional checks plus the T1–T8 bound checks |
| `test/authSessionDormancy.test.ts` | 16 checks: D1–D4 plus negative fixtures |
| `.github/workflows/ci.yml` | +2 steps in `math-core-tests`, +1 step in `db-migration-validation`. Nothing else changed. |
| `AURA_AUTH_SESSION_01_*` | Design, ticket, this handover, and the design and I1 evidence |

## 4. Security properties as implemented

1. **No Production dependency on the new key.** The I1 modules never read `process.env` (guard D2). Nothing runs at import, so no pool and no key exist until a caller makes them (D3). `deriveSessionKey(secret)` takes its secret as an argument, and nothing outside the tests calls it. There is no new env var.
2. **Domain-separated key.**
   - It is HKDF-SHA256 with salt `aura.session` and info `aura-session-v2`.
   - The key bytes are non-enumerable, so they never appear in JSON or logs.
   - Only keys made by `deriveSessionKey` are accepted; a forged key object throws.
3. **Strict v2 verifier.**
   - Exactly the six payload keys; `typ` and `v` must match exactly.
   - `sid` must be 43 base64url characters and `uid` a UUID.
   - The lifetime may not exceed 30 days, and `iat` may be at most 60 s in the future.
   - Signatures are compared in constant time, and tokens longer than 1 024 characters are refused.
   - Tests show it rejects v1 session, magic-link, guest-state, preview and recomposition tokens, and a v2-shaped payload signed with the legacy key. The legacy `verify()` and `verifySessionToken()` reject v2 tokens.
4. **Allowlist and database clock.**
   - A lookup succeeds only for a row that exists, has `revokedAt IS NULL` and `expiresAt > now()`, with a matching `userId`.
   - `expiresAt` is set to `now() + make_interval(days => 30)` **by the database**.
   - The raw session id is never stored, and the table holds no email, IP or user agent.
5. **Bounds the database enforces (design §8.1)**, each confirmed through `pg_stat_activity`:
   - **L1:** the `aura-session` pool allows `max 5` connections and waits at most 500 ms to acquire one.
   - **L2:** the statement runs inside **one simple-query message** that sets `statement_timeout` and `lock_timeout` with `SET LOCAL` (lookup: 1 000 / 250 ms; write: 1 500 / 1 000 ms; cleanup: 5 000 / 1 000 ms).
   - **L3:** a single absolute deadline (2 s for lookups). When it passes, the connection is **discarded** with `release(err)` and a late result is never used.
   - Every failure becomes `SessionVerificationUnavailableError`. A connection that saw any error is discarded, so no aborted transaction is reused.
6. **Inlined values are pattern-checked.** The simple query protocol inlines values. `sqlLiteral` accepts only a 43-character base64url hash, a UUID or one of the four revoke reasons, and the code also refuses any statement containing `;`. Transaction-scoped helpers use bound parameters. Database CHECK constraints repeat the hash format, the allowed reasons and "a revocation always has both timestamp and reason".
7. **Revocation.**
   - Revoke is idempotent (`revoked` or `already_inactive`) and retries once if the outcome is ambiguous; otherwise it throws, so it never reports success without a confirmed write.
   - Revoke-all runs inside the caller's transaction.
   - `ON DELETE CASCADE` removes a deleted user's sessions.
   - Cleanup deletes in bounded batches and removes only rows expired or revoked more than 7 days ago.

## 5. Deviations from the ticket text (for the reviewer)

| Ticket | Implementation | Why |
|---|---|---|
| Error field `cause` | Named **`reason`** | `Error.cause` is a standard ES2022 property with different meaning. The values are the same list plus `constraint`. |
| — | Added a **`constraint` reason** for SQLSTATE class 23 | Separates "write refused by integrity" (for example an unknown user) from infrastructure failure. It still fails closed. |
| `createAuthSession(pool, userId)` | Also added **`createAuthSessionInTransaction(client, userId)`** | Design §2.4 needs code consumption and session creation in one transaction during I2. It is dormant too. |
| `sqlLiteral` uses `escapeLiteral` | Strict pattern, then single quotes | Every accepted alphabet excludes quotes, backslashes and NUL, so escaping is not needed. This also avoids depending on the `escapeLiteral` export across `pg` versions (web has `^8.12`). |
| Separate write and cleanup bounds were not specified | `SESSION_WRITE_BOUNDS` (1 500 / 1 000 / 2 000), `SESSION_CLEANUP_BOUNDS` (5 000 / 1 000 / 6 000) | A revoke may briefly wait behind a B3 `FOR SHARE`, and cleanup deletes up to 5 000 rows |
| `boundedSessionQuery` signature | `(pool, statement, bounds)`; it refuses a `;` in `statement` | One statement per message, so a stray terminator can't be smuggled in |

## 6. Verification performed (local, 2026-11-27)

**Environment:**
- A throwaway PostgreSQL 16.14 cluster in the session scratchpad on `127.0.0.1:55992` with trust auth, created for this run and **stopped** afterwards. It is no shared, staging or Production database.
- All 55 migrations applied in order with `psql -1 -v ON_ERROR_STOP=1`.
- Node v26.5.0, with the main checkout's root `node_modules` symlinked; the symlink is not committed.

| # | Check | Result |
|---|---|---|
| V1 | `git diff origin/main` on `lib/auth.ts`, `lib/session.ts`, `lib/db.ts`, `app/`, `pages/`, `components/` and both `package.json`/lockfiles | **Empty** |
| V2 | Migration chain 0001–0055 on a fresh DB | **55/55 applied.** `\d "AuthSession"` matches §2.1 (PK, FK cascade, 4 CHECKs, 2 indexes). |
| V3 | `prisma validate` (Prisma CLI 5.22.0, run from another worktree's install) | **Valid** |
| V4 | `prisma migrate diff`, live DB → `schema.prisma` | **No `AuthSession` drift.** There are 263 lines of drift in other tables, all pre-existing (migrations are the source of truth); none of it is introduced here. |
| V5 | Typecheck of the 4 new modules with web settings (`bundler`, `isolatedModules`, strict) | **OK** |
| V6 | Typecheck of the 3 tests with root settings (commonjs, strict) | **OK** |
| V7 | `authSessionToken.test.ts` | **67 passed, 0 failed** |
| V8 | `authSessionDormancy.test.ts` | **16 passed, 0 failed** (including 9 negative fixtures) |
| V9 | `authSessionStoreDb.test.ts`, **5 consecutive runs** | **50 passed, 0 failed every run.** No rows left afterwards (0 sessions, 0 synthetic users). |
| V10 | CI YAML parses | OK |

**Bound results** (run 1; `AURA_AUTH_SESSION_01_I1_EVIDENCE/storeDb-run*.log`):

| Test | Observed |
|---|---|
| T1 lock | `lock_timeout` at **251 ms**. No `aura-session` backend left waiting (5 ms). |
| T2 statement | `statement_timeout` at **1 003 ms**, cancelled by PostgreSQL. The backend is not sleeping afterwards. |
| T3 client deadline | `deadline` at **201 ms**. The next lookup is fast. Nothing is checked out, the server statement ended at about 1 017 ms (its own bound), and no backend is orphaned. |
| T4 acquire | `acquire` at **502 ms**. Nothing queued, and it works again once a connection is free. |
| T5 recovery | 5 backends terminated. 4 lookups after that all `ok`, without a restart. 0 uncaught errors (the pool logs the error class only). |
| T6 driver | An ended pool gives `driver`, with the fixed message and no id or token. |
| T7 burst | 50 concurrent lookups against a locked table all fail closed (`lock_timeout` or `acquire`). Maximum 5 backends, about 510 ms wall time, none active after the lock is released. |
| T8 normal | 1 000 bounded lookups: p50 0.07–0.12 ms, p95 0.10–0.38 ms over 5 runs (loopback). |

**Mutation negative controls.** Each mutation was applied to a temporary copy of `authSessionDb.ts`, and the file was restored and confirmed byte-identical with `cmp`.

| Mutation | Caught by |
|---|---|
| M1: drop `SET LOCAL statement_timeout` | T2 (reports `deadline` at 3 002 ms; the backend is still sleeping) and T3 (the server statement keeps running; orphan backend). **4 failures** |
| M2: return a timed-out or errored connection to the pool instead of discarding it | The run aborts: an aborted transaction is reused by the next operation. **Caught** |
| M3: drop `SET LOCAL lock_timeout` | T1 (reports `statement_timeout`, not `lock_timeout`) and T7. **2 failures** |

## 7. Not verified here (for the independent verifier and CI)

- **CI was not run**, because the branch is not pushed. The three new steps run in CI for the first time on the PR.
- **`prisma migrate deploy` and `prisma migrate status`** ran only in CI terms. Locally the chain was applied with `psql`. The `db-migration-validation` job runs the real commands, plus the "all migrations recorded" check, which should now count 55.
- **Next.js web build** was not run. Only the new files were typechecked with web settings; the `web-build` job covers the full build.
- **Existing auth test suites were not re-run locally.** Their code is unchanged (V1), and CI runs them.
- **The Neon pooler** was not exercised: transaction-mode `SET LOCAL` in one message, the extra 5 connections, and real latency. That is the I2-S staging item (design §8.1, §10).
- **Native devices** were not tested: N1–N8 belong to I2-S (design §9.1).

## 8. Independent verification checklist

Run from the worktree, with a **disposable loopback** Postgres:
```bash
git -C .claude/worktrees/auth-session-01 log --oneline -1
git -C .claude/worktrees/auth-session-01 diff origin/main --stat
git -C .claude/worktrees/auth-session-01 diff origin/main -- apps/web/lib/auth.ts apps/web/lib/session.ts apps/web/app apps/web/pages apps/web/components
npx ts-node test/authSessionToken.test.ts
npx ts-node test/authSessionDormancy.test.ts
DATABASE_URL=postgresql://USER@127.0.0.1:PORT/DB npx ts-node test/authSessionStoreDb.test.ts
```
The DB test needs `cd apps/web && DATABASE_URL=… npx prisma migrate deploy` first, and it refuses any database that isn't on loopback.

Suggested review focus:
1. `boundedSessionQuery`: discard paths, the `abandoned` checkout race, and the five-result shape check.
2. `sqlLiteral` patterns and the `;` refusal.
3. The verifier's payload rules.
4. The dormancy scanner's coverage, including dynamic `import()`.
5. That the migration is additive only.
6. **Independently re-run M1–M3.**

## 9. Restrictions observed

There was no authentication behaviour change, credential read or rotation, session invalidation, Production, staging or Vercel access, migration on any shared database, dependency change, push, PR, merge or deploy. No other workstream's files were touched; MP-1 was read only.

**Next steps, each needing separate approval:**
- push and open the I1 PR, which carries the design, ticket, evidence and this handover;
- independent verification;
- merge approval.

Once I1 is merged, migration 0055 reaches the Production database as an empty, unused table with the next authorized Production release.

## 10. PR, pre-push checks and CI (2026-11-27)

**Pre-push review:**
- `git diff 477723d..5d8a16c` was confirmed as the 22 files in §3, with no change to the protected paths (V1).
- **Secret and sensitive-data scan** of every changed file covered connection strings, passwords, `AUTH_SECRET=`, bearer and JWT tokens, private keys, personal email and home paths. It found **one** hardcoded loopback connection string in `AURA_AUTH_SESSION_01_EVIDENCE/bench.js` (throwaway, passwordless), and the synthetic benchmark id hash and user UUID in `bench-output.txt`'s query plan.
- **Both were fixed in `29bf09d`** before the push. `bench.js` now reads `BENCH_DATABASE_URL`, refuses any database not on loopback, and redacts the plan literals; the recorded plan is redacted to match.
- The test logs contain no emails, UUIDs, hashes or tokens; the scan was re-run and came back clean.
- The only `postgresql://` strings left in the diff are the placeholder `USER@127.0.0.1:PORT/DB` in this handover and the pre-existing CI-only lines in `ci.yml`, which this PR doesn't change.

**Preview deployment:** Vercel built an automatic **Preview** deployment for the PR (GitHub deployment `environment: Preview`, `production_environment: false`). `apps/web/scripts/vercel-build.sh` runs `prisma migrate deploy` **only when `VERCEL_ENV=production`**, so **no database was migrated**. Nothing was promoted.

**How each required verification is covered:**

| Required | Covered by | Result |
|---|---|---|
| Real `prisma migrate deploy` + `status` on a disposable DB | CI `Database migration validation`: postgres:16 service, then `migrate deploy`, `migrate status`, the "all migrations recorded" count, and the new I1 DB test | see CI table |
| Full web production build + typecheck | CI `Next.js production build` (`next build` typechecks all of `apps/web`, including the new modules, then the bundle guards and standalone checks) | see CI table |
| Existing auth regression suites | CI: `authRequestLinkQuotaDb`, `authLogRedactionDb`, `authMagicLinkLocalOnlyDb` (Day Constructor acceptance DB job), `signInResendChangeEmailJsdom` (Ephemeris job) and `mcpOAuthLocal` (consent cookie path) | see CI table |
| New token, store, timeout and isolation tests | CI: `authSessionToken` and `authSessionDormancy` (Ephemeris job), `authSessionStoreDb` (migration validation job) | see CI table |
| Extra, not in CI: other token types sharing `AUTH_SECRET` | Local: `remainingDayRecompositionIntegrity.test.ts`, **all 97 checks passed**; `guestConversion.test.ts`, **all checks passed** | PASS |

Every required item is covered by CI, so no separate local run was needed. The extra local runs only add evidence that the legacy token paths are unaffected.

**CI run [45973451075](https://github.com/ste277/aura-updated/actions/runs/45973451075)** on head `29bf09d`: see the table below. Per instruction, a failure of the known Rhythm Move test (CI-09) is recorded as-is: not rerun, not modified.

