# AURA-AUTH-SESSION-01-I1 R1 — Corrections and Independent Verification Handover (39233)

**Date:** 2026-11-27 · **Responds to:** independent verification 39232 (NO-GO) on head `864da6f`
**PR:** [#401](https://github.com/ste277/aura-updated/pull/401), still a draft. The branch is `feature/aura-auth-session-01-i1`, branched from `477723d`. It has not been synced with main.
**Revisions:**
- approved original implementation: `5d8a16c`;
- reviewed head: `864da6f`;
- R1 head: the single R1 commit on top of `864da6f`. Its SHA, and the integration SHA CI tests, are recorded in the checksummed CI addendum (§9).

**Status:** R1 IMPLEMENTED AND LOCALLY VERIFIED. **I1 stays dormant.** There is no I2 or I3 work, and no route, cookie or activation change.

**Audit limitation, recorded and not claimed as verified:** the complete 39232 disposition and its reproduction evidence weren't available to this session. They were not in the repository, any worktree, the PR comments or the session scratchpad. Each finding was therefore **reproduced independently from the 39233 description** before it was changed (§2). Where the independent reproduction might differ from the reviewer's, compare the two directly.

---

## 1. What changed

| Area | Files | Change |
|---|---|---|
| 39232-01 | `lib/authSessionDb.ts`, `lib/authSessionStore.ts`, `lib/sessionErrors.ts` | Each operation has one absolute deadline on a monotonic clock, which is injectable for tests, with an optional external `deadlineAt` that can only shorten it. The acquisition wait and the `SET LOCAL statement_timeout` / `lock_timeout` are each `min(phase maximum, remaining budget)`. Every error carries an `outcome`: `failed` (never sent, or rejected by PostgreSQL before COMMIT) or `uncertain` (sent, result unknown). `revokeAuthSession` retries **only** an uncertain outcome, once, within the **same** deadline, and only if at least 300 ms remain. Connections are still discarded after any failure. |
| Timeout contract | `lib/authSessionDb.ts`, design §8.1, ticket | **Lookup:** acquire 500 / lock 250 / statement 1 000 / deadline 2 000 ms. **Write:** 500 / 1 000 / 1 500 / 2 000. **Background cleanup:** 500 / 1 000 / 5 000 / 6 000. These are maxima, not cumulative allowances. The pool stays at five connections. Cleanup is documented as background-only. |
| 39232-02 | `lib/authSessionStore.ts` | `createAuthSession` returns a `CommittedAuthSession`, which carries a private brand. `createAuthSessionInTransaction` returns a distinct `ProvisionalAuthSession`: `state: 'provisional'`, **no `sid`**, and it never sends BEGIN, COMMIT, ROLLBACK or SET. `confirmCommittedAuthSession(pool, provisional)` reads the row back on an **independent** connection after the caller's COMMIT, whether acknowledged or uncertain, and only then releases the raw id inside a `CommittedAuthSession`. It returns null when there is no row, and can be used only once per provisional result. The caller's responsibilities are documented: the transaction and its timeouts, cookie issuance only from a committed session, and the B3 re-check. |
| 39232-03 | `test/authSessionDormancy.test.ts` | Rewritten on the **TypeScript AST**, using the repository's own `typescript`, so there is no new dependency. It covers every import form and separates type-only from runtime references. It checks transitive runtime reachability from 110 entry points (app/, pages/, root and `src/` middleware and instrumentation, `next.config.js`, `capacitor.config.ts`, following relative and `@/` paths). It detects import-time evaluation inside blocks, IIFEs, class static blocks and static initialisers. It adds an isolated child-process import probe with an empty application environment and instrumented side effects. |
| Fixed expiry | `lib/authSessionDb.ts` (`SESSION_TTL_SQL`), `lib/authSessionToken.ts` (`SESSION_TTL_HOURS`) | Expiry is `now() + make_interval(hours => 720)`, which is 720 **elapsed** hours. It was `days => 30`, which gave 719, 721 or 720.5 h across DST. Cleanup grace is also expressed in hours. **Migration 0055 is unchanged.** |
| Tests and CI | `test/authSessionDeadline.test.ts` (controlled clock), `test/authSessionContract.test.ts` (compile time), `test/authSessionR1Db.test.ts` (real PostgreSQL), `test/authSessionFaultProxy.ts` (loopback TCP fault injection, `node:net` only), `ci.yml` (+3 steps) | Two existing assertions were updated to the R1 contract. The token test's error shape now includes `outcome`. Store-DB check T3 now accepts that a 200 ms deadline is enforced by PostgreSQL's clamped statement timeout. |

**Unchanged:**
- `lib/auth.ts`, `lib/session.ts`, `app/`, `pages/` and `components/` (`git diff 864da6f` over them is empty);
- migration 0055;
- `schema.prisma`;
- every `package.json` and lockfile.

## 2. Before and after reproduction

The same script, `AURA_AUTH_SESSION_01_I1_R1_EVIDENCE/repro/reproFindings.ts`, ran against `864da6f` (`before/`) and R1 (`after/`).

| Probe | `864da6f` | R1 |
|---|---|---|
| 01a stalled server, 2 000 ms caller budget | **4 003 ms, 2 attempts**, `deadline` | **2 000 ms, 1 attempt**, `deadline` / `uncertain` |
| 01b confirmed `lock_timeout` | **retried: 2 attempts, 2 008 ms** | **1 attempt, 1 003 ms**, `lock_timeout` / `failed`, row not revoked |
| 02 provisional result after caller rollback | same keys as committed, **exposes `sid`**, no state | `state: 'provisional'`, **no `sid`**, different shape |
| 05 expiry across DST (`America/New_York`, `Europe/London`, `Australia/Lord_Howe`) | **719 h / 721 h / 719 h / 720.5 h** | **720 h** in every zone |

**39232-03, dormancy bypasses** (`before/dormancy-bypass-864da6f.txt` and `after/dormancy-bypass-r1.txt`):

| Probe | Old guard | New guard |
|---|---|---|
| root `middleware.ts` imports the store | missed | detected |
| root `instrumentation.ts` dynamic import | missed | detected |
| route `import()` with a template literal | missed | detected |
| route `require()` with a template literal | missed | detected |
| I1 module: pool created inside a top-level `if` | missed | detected |
| I1 module: key derived in an IIFE | missed | detected |
| I1 module: top-level `setTimeout` | missed | detected |
| route `export *` / nested barrel re-export | detected | detected |

## 3. Timeout and retry results

**Controlled clock** (`authSessionDeadline.test.ts`, **27/27**). Exact virtual-time assertions on result, attempt count, elapsed time, SQL limits sent and connection disposal:
- budgets match §1;
- 1: success, 15 ms, 1 attempt;
- 2: confirmed statement timeout, no retry, 1 500 ms;
- 3 / 3b: confirmed lock timeout or constraint failure, no retry;
- 4 / 4b: acquisition failure at exactly 500 ms with nothing sent;
- 5: uncertain, then a safe retry on a fresh connection;
- 6: a retry at t = 1 600 ms is sent with limits of **400 ms**, the remaining budget;
- 7 / 7b: below 300 ms remaining there is no retry; at exactly 300 ms one retry is allowed;
- 8: exhaustion at exactly 2 000 ms;
- 9 / 9b: a hanging retry still ends at the **original** 2 000 ms, not 3 600 ms, and the retry's acquisition wait is cut to the 400 ms remaining;
- 10: a late completion at 2 100 ms is ignored and the connection discarded once;
- 11: pool recovery;
- 12–12d: exact boundaries (sent at 1 999 ms with 1 ms limits; nothing sent at 2 000 ms; an external `deadlineAt` can only shorten the budget);
- 13: lookups are never retried.

**Real PostgreSQL** (`authSessionR1Db.test.ts` part A), **all passing**:

| # | Case | Observed |
|---|---|---|
| A1 | locked table | `lock_timeout` / `failed`, **1 attempt, 1 002 ms**, row not revoked |
| A2 | commit happened, acknowledgement lost (proxy cuts after forwarding) | retried once, `already_inactive`, row revoked once |
| A3 | statement never reached the server | retried once, `revoked` |
| A4 | answer black-holed | **1 attempt, 2 001 ms**, `deadline` / `uncertain`. The database shows the UPDATE **did** commit, which is why it is reported uncertain and never as success. |
| A5 | lost, then retry black-holed | **2 attempts, total 2 000 ms** (not about 4 000) |
| A6 | the same faulty pool afterwards | revokes and looks up normally |
| A7 | pool exhausted | `acquire` / `failed`, 502 ms, 1 attempt |
| A8 | `pg_sleep` under write bounds | `statement_timeout` / `failed` at 1 502 ms; no backend left running |

The existing store-DB bound tests T1–T8 still pass (50/50).

## 4. Transaction durability and the provisional result (part B, all passing)

- **B1:** a provisional result has no `sid` in its keys or JSON. Its row is visible in the caller's transaction and **absent from an independent connection** before commit. The helper sent exactly one INSERT, and the caller's own `SET LOCAL statement_timeout = 4321ms` is untouched.
- **B2:** after caller rollback the row is absent and confirmation returns null.
- **B3:** an unrelated later failure (22012) aborts the transaction (25P02); after rollback there is no row and no session.
- **B4:** a foreign-key failure propagates as `constraint` / `failed`, and the transaction is left aborted for the caller.
- **B5:** after caller COMMIT, confirmation returns a committed session whose `sid` hashes to the row. A second confirmation is refused with TypeError.
- **B6:** COMMIT executed but its acknowledgement was lost, injected on the caller's connection by an isolated fault. The caller sees an uncertain commit, and independent confirmation finds the session **committed**.
- **B7:** COMMIT never reached the server. The caller sees an uncertain commit, and confirmation finds **no row**.
- **B8:** standalone creation is unchanged: committed on return.
- **Compile time** (`authSessionContract.test.ts`): `p.sid` on a provisional session, assigning a provisional session to a committed one, building a committed session from a plain object, and claiming `state: 'committed'` on a provisional one are all **type errors**. The control, removing one `@ts-expect-error`, fails with TS2339.

## 5. Dormancy guard coverage (33/33)

- **Real tree:** 419 production files and 110 entry points; 498 files are reachable through runtime edges, including files under `packages/`. There are **no** violations.
- **Import probe:** all four modules load in a child process with only `PATH` set, plus the macOS-injected `__CF_USER_TEXT_ENCODING`; no application variable is present. Loading triggers **no** pg Pool or Client construction, net connection, timer, `process.env` read, `hkdfSync`, `randomBytes`, `createHmac` or filesystem write.
- **Negative fixtures, all rejected:**
  - middleware, also via `src/` and the `@/` alias, and instrumentation;
  - an existing route (the real logout route plus an aliased import);
  - namespace, default and side-effect imports;
  - `export *` and named re-exports;
  - template-literal `import()` and `require()`, `import = require`, and a computed dynamic import;
  - an indirect barrel (D1 on the barrel, and a D1b chain from the route);
  - in I1 modules: a top-level `if`, an IIFE, a class static block, a conditional `new Pool`, and `process['env']` inside a function.
- **Allowed:** type-only imports and exports, calls inside function bodies of I1 modules, and `test/` files.
- **Probe control:** an import-time timer and an environment read are recorded.

## 6. Mutation negative controls

These are in `mutations/mutation-results.json`. Each file was restored and its sha256 verified identical.

| Mutation | Caught by |
|---|---|
| M1 remove the server statement timeout | store-DB T2 (cancelled only by the client at 3 001 ms, backend still sleeping) and R1Db A8 |
| M2 unsafe connection reuse | deadline tests 5 / 8 / 10, and the store DB run aborts on a reused aborted transaction |
| M3 deadline reset on retry | deadline tests 6 and 9: the retry is sent with 1 500 / 1 000 ms limits, and it ends at **3 600 ms**. *R1Db A5 alone doesn't catch this: its 2 400 ms tolerance absorbs a fresh deadline when the first attempt fails instantly. The exact boundary is proven by the controlled-clock tests.* |
| M4 retry confirmed failures | deadline tests 2 / 3 / 4, and R1Db A1 / A7 |
| M5 calendar-day expiry | R1Db C2 |
| M6 provisional exposes `sid` | R1Db B1 |

The dormancy-guard bypass control is §2 and §5.

## 7. Expiry is independent of timezone (part C, all passing)

- **C1:** created through pools whose sessions run in `UTC`, `America/New_York`, `Europe/London`, `Australia/Lord_Howe`, `Asia/Kolkata` and `Pacific/Chatham` (confirmed with `SHOW TimeZone`), the stored lifetime is **exactly 720 h**.
- **C2:** the production expression gives 720 h across six DST transitions. The calendar-day control gives 719 / 721 / 720.5 / 721 h, which is the defect, kept as a regression control.
- **C3:** the token and cookie constants are the same 720 h.

Expiry stays database-authoritative and non-sliding, and existing cookies are unchanged.

## 8. Regression, migrations and MP-1

- **Full I1 suites, local (CI layout, disposable PostgreSQL 16):**

  | Suite | Result |
  |---|---|
  | token | 68/68 |
  | contract | 2/2 |
  | deadline | 27/27 |
  | dormancy | 33/33 |
  | store DB | 50/50 |
  | R1 DB | 26/26 |

- **Full Ephemeris job replay on the R1 tree:** **246 / 246** runnable steps pass, using the same runner as I1 §11 (`ephemeris-replay/replay-r1-summary.txt`). That includes the auth-adjacent and guard suites and the new R1 steps.
- **Real `prisma migrate deploy` and `status`** on fresh disposable databases: all applied and up to date.
- **MP-1 compatibility**, against revision **`72ca7b90978cf9a21df7840853047b5a68e1742d`** (PR #400 head, no dependency change), tested in both orders on a local merge that was never committed or pushed:
  - **Order A** (0055 then 0056) and **Order B** (0056 first, then 0055 applied out of order): `migrate deploy` succeeds and `status` reports 56 migrations up to date, with the ledger at 56.
  - In both orders the following pass: I1 store DB 50/50, R1 DB 26/26, and `birthDateWritersDb`, `myPeopleDb`, `myPeopleSwitchRollbackDb`, `myPeopleR1Db`, `peopleViewLegacyEditorDb` and `myPeopleR2Db`.
  - In the combined tree, the PREF-01, MR3 and INS-01 guards, dormancy, token, deadline, contract and `myPeopleRequest` all pass.
- **The three exact-name migration guards are kept.** The merge produced **exactly** the three predicted conflicts (11o, G12, S9) and no others; the union resolution is in `mp1-compat/union-resolution.diff`. **The second-merge requirement with PR #400 stands:** whichever PR merges second must allow both `0055_auth_session` and `0056_my_people_foundation` (plus 0054 in G12 and S9).

**Preserved I1 guarantees** (re-verified by the suites above):
- existing authentication is unchanged, and nothing is activated;
- session ids come from the CSPRNG and are stored only as hashes;
- the signing key is separated, and tokens are verified strictly;
- account isolation, revocation and cleanup work as before;
- error messages are fixed;
- connections are disposed of safely, and the pool is dedicated and isolated;
- there is no schedule-write lock interaction, and the error-label module contains no SQL. The Ephemeris architecture guards 206 and 212 still pass.

## 9. CI and checksums

- **CI:** the run triggered by the R1 push, with no deliberate rerun, is recorded together with the R1 head, base and integration SHAs and the auto-merge and auto-fix state in `AURA_AUTH_SESSION_01_I1_R1_EVIDENCE/final-ci-addendum.txt` and its `.sha256`. That addendum is **uncommitted**, so there is no documentation-only commit.
- **Checksums:** `AURA_AUTH_SESSION_01_I1_R1_EVIDENCE/SHA256SUMS` covers every committed R1 evidence file.

## 10. Restrictions observed

**Not done:**
- no I2 or I3, and no route, cookie or activation change;
- no branch sync, deliberate CI rerun, merge, deployment or Production database access;
- no persistent migration (disposable loopback databases only) and no credential rotation;
- auto-merge and auto-fix left off.

**Used:** synthetic credentials and users, disposable databases, and an in-process loopback fault proxy.
