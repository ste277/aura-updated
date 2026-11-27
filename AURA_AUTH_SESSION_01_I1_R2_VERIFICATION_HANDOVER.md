# AURA-AUTH-SESSION-01-I1 R2 — Commit Authorization Correction and Independent Verification Handover (39235)

**Date:** 2026-11-27 · **PR:** [#401](https://github.com/ste277/aura-updated/pull/401), still a draft, with auto-merge and auto-fix off.
**Revisions:**
- previous R1 head: `84196311f41a53be3f4ef5ada4680aacf65a6131`;
- R2: **one focused commit** on top of R1 (its SHA and the CI integration SHAs are in the uncommitted final CI addendum, written only once all jobs pass);
- branch point `477723d`, not synced; MP-1 tested at `72ca7b90978cf9a21df7840853047b5a68e1742d`.

**Scope:** the commit-authorization correction only. There is no I2 or I3 work and no MCP change. Migration 0055, `schema.prisma`, the deadline and retry code, the budgets, the pool, the dormancy guard and the 720-hour lifetime are all **unchanged**. `git diff 8419631` over `apps/web/prisma`, `authSessionDb.ts`, `authSessionToken.ts`, `sessionErrors.ts`, `auth.ts`, `session.ts`, `app/`, `pages/`, `components/`, `packages/`, `apps/mcp` and every `package.json` and lockfile is empty.

**Retained limitations:**
- The standalone 39232 disposition was unavailable to this work. See the R1 handover.
- The deadline-reset mutation (M3) is detected by the controlled-clock tests, not by the real-PostgreSQL test alone.

---

## 1. The correction

The approved contract prohibits issuing a session after an **ambiguous** caller COMMIT.

**In R1**, `confirmCommittedAuthSession` couldn't tell an acknowledged COMMIT from an ambiguous one. It released the raw id whenever a read-back found the row.

**In R2**, the five facts are kept separate and typed:

| Fact | R2 interface | What it can yield |
|---|---|---|
| Provisional creation | `createAuthSessionInTransaction(client, userId)` → `ProvisionalAuthSession` | no `sid`, no symbols, nothing cookie-issuable |
| The caller's COMMIT, classified | `commitAuthSessionTransaction(client, provisional)` → `CallerCommitDecision` | `committed`: PostgreSQL answered `COMMIT`; it **alone** carries a `CommitAuthorization` (private brand). `rolled_back` (confirmed): the reply was `ROLLBACK` for an aborted transaction, COMMIT was rejected with class 23 / 25 / 40, the open transaction no longer holds the row, or COMMIT was never sent. `ambiguous`: connection lost, deadline, or an unexpected reply. For everything except `committed`, **the raw id is destroyed at once**. |
| Database read-back after a confirmed commit | `releaseCommittedAuthSession(pool, authorization)` | `CommittedAuthSession` (with the raw id) **only** for a live, matching row (same `idHash` **and** `userId`, not revoked, not expired). Otherwise null. Throws when unavailable. Releases at most once. |
| Database read-back after an ambiguous commit | `classifyAmbiguousCommit(pool, provisional)` | `'committed_undisclosed'` or `'not_committed'`: **a label only, never session material** |
| Authorization to release | Only `committed` → `CommitAuthorization` → `releaseCommittedAuthSession` | A cookie may be issued only from a `CommittedAuthSession`. **Never after `rolled_back` or `ambiguous`, whatever the read-back finds.** An undisclosed committed row is acceptable: its raw id never leaves the server, so it can't authenticate, and it expires and is cleaned up. |

**Caller-owned boundary.** The caller still owns `BEGIN`, every statement, **when** to commit, any `ROLLBACK`, and its `SET LOCAL` timeouts. The INSERT helper sends only the INSERT. The commit helper is called by the caller **as** its commit, and sends one in-transaction check followed by `COMMIT`; it never sends `BEGIN`, `ROLLBACK` or `SET`.

**Why the check before COMMIT.** After a caller's own `ROLLBACK`, a bare `COMMIT` on a connection with no transaction is acknowledged by PostgreSQL with a warning. Without the check, that would wrongly produce an authorization. Mutation M10 shows the check is what prevents it.

**`confirmCommittedAuthSession` is removed.** The corrected documentation is in `authSessionStore.ts` (module, INSERT, commit, release and classify comments), the ticket table, design §2.4, the R1 handover (§1 and §4 B6/B7, marked "Corrected in R2") and the CI comment.

## 2. Before and after

The same script, `repro/reproCommitAuthorization.ts`, was run against R1 (`before/`) and R2 (`after/`), with a real disposable PostgreSQL and the existing fault-injection proxy.

| Scenario | R1 `8419631` | R2 |
|---|---|---|
| Acknowledged COMMIT | released `sid` | `committed`, then released `sid` (correct) |
| **Ambiguous COMMIT that actually succeeded** (row committed) | **RELEASED raw `sid`** (the defect); later attempts TypeError | `ambiguous`; read-back gives `committed_undisclosed` ×3; **nothing released** |
| Ambiguous COMMIT that did not succeed | null, null | `ambiguous`; `not_committed` ×2; nothing released |

## 3. Real-PostgreSQL verification (`authSessionR1Db.test.ts` part B, **42/42** with parts A and C)

| # | Required case | Result |
|---|---|---|
| B1 | provisional creation exposes no cookie-issuable material | keys exactly `expiresAt,idHash,state,userId`; no `sid`, no symbols, no `sid` in JSON. Visible only inside the caller's transaction. One INSERT was sent, and the caller's `SET LOCAL` is untouched. |
| B2 | confirmed commit + valid read-back → release | `committed`. The commit helper sent only its check and `COMMIT`. The released `sid` hashes to the row. A second release gives TypeError. |
| B3 | confirmed commit with a **missing**, **expired**, **revoked** or **mismatched** (another account) row | all four give **null** |
| B4 | confirmed rollback | the caller's own `ROLLBACK` gives `session_not_in_transaction`, and retrying gives TypeError. An aborted transaction (22012) gives `aborted_transaction`. A deferred-constraint COMMIT failure (23505) gives `rejected_at_commit`. In every case there is no authorization and no row. An INSERT foreign-key failure propagates as `constraint` / `failed`. |
| B5 | **ambiguous commit that actually succeeded** (the old B6 case, **corrected**: it now expects no release) | `ambiguous` with **no authorization**. The row **is** committed. Read-back gives `committed_undisclosed` three times and **never** a `sid`. The provisional can't be committed again (TypeError). |
| B6 | ambiguous commit that did not succeed | `ambiguous`, `not_committed`, no row |
| B7 | ambiguous commit + **unavailable** read-back | throws `unavailable`, with no material; a later read-back still only labels |
| B8 | black-holed COMMIT answer | `ambiguous` (deadline) at 2 002 ms, no authorization |
| B9 | **cross-account** and forged inputs | a forged `CommitAuthorization` is refused. A real authorization copied and re-pointed at another account's live session is refused. Classification is refused unless the commit was ambiguous. |
| B10 | standalone `createAuthSession` | unchanged: committed on return |

**Repeated read-back can't turn an ambiguous commit into authorization:**
- the raw id is destroyed when the commit is found ambiguous;
- classification returns only a label (B5, three times);
- the provisional can't be committed again (B5);
- there is no interface from a label, or from a provisional, to release (§4).

## 4. Compile-time and runtime negative controls

- **Compile time** (`authSessionContract.test.ts`): 10 `@ts-expect-error` assertions. They cover:
  - no `sid` on a provisional session or a classification label;
  - a provisional session or a label can't be assigned to `CommittedAuthSession`;
  - neither a committed session nor an authorization can be fabricated;
  - release can't take a provisional session or an un-narrowed decision;
  - an `ambiguous` or `rolled_back` decision has no `.authorization`.

  **Removing each one in turn makes compilation fail with the expected TS error.** See `controls/compile-time-controls.txt`: 10 of 10.
- **Runtime** (same file, a scripted client, 18/18):
  - acknowledged COMMIT gives `committed`;
  - a `ROLLBACK` reply, a 40001 rejection, no open transaction, and a connection lost before send each give `rolled_back`;
  - a socket error, 08006, 57P01 and an unexpected reply each give `ambiguous`, and the provisional can never be committed again;
  - forged authorizations and hand-made provisionals are refused.
- **Mutation controls** (`mutations/mutation-results.json`). Each mutated file was restored and its sha256 verified identical.

  | Mutation | Caught by |
  |---|---|
  | **M7** ambiguous COMMIT treated as acknowledged | contract runtime checks; R1Db stops |
  | **M8** ambiguous keeps the raw id and read-back releases it | B5, B7 |
  | **M9** release ignores the read-back | B3 ×4 (`RELEASED`) |
  | **M10** check before COMMIT removed | contract runtime check; B4 |

  **R1's M1–M6 are retained and re-run on R2, and all six are still caught.** M3 is caught by the controlled-clock tests (deadline tests 6 and 9) and **not** by R1Db alone; that caveat is kept.

## 5. Regression (local, CI layout, disposable PostgreSQL 16)

`regression/summary.txt`:

| Suite | Result |
|---|---|
| `authSessionToken` | 68/68 |
| `authSessionContract` | 18/18 |
| `authSessionDeadline` | 27/27 |
| `authSessionDormancy` | 33/33 |
| `authSessionStoreDb` | 50/50 |
| `authSessionR1Db` | 42/42 |
| `availabilityPreferencesPref01`, `myRhythmPreferencesUi`, `insightsAlignmentSafeguards`, fresh-overlap architecture, manual-writer serialization architecture | all passed |
| auth DB suites `authRequestLinkQuotaDb` / `authLogRedactionDb` / `authMagicLinkLocalOnlyDb` | 24 / 47 / 136 checks, all passed |

- **Full Ephemeris job replay on R2:** **246 / 246** runnable steps pass (`ephemeris-replay/replay-r2-summary.txt`).
- **MP-1 `72ca7b9`, both orders** (`mp1-compat/`):
  - Order A (0055 then 0056) and Order B (0056 first, then 0055) both give real `migrate deploy` success, `status` 56 up to date and a ledger count of 56.
  - In both orders the following pass: I1 store DB 50/50, R1 DB 42/42, `birthDateWritersDb`, and all five MP-1 DB suites.
  - In the combined tree, the three union-resolved guards, dormancy, token, deadline, contract and `myPeopleRequest` all pass.
  - The merge again produced exactly the three predicted guard conflicts (`union-resolution.diff`). **The second-merge reconciliation requirement with PR #400 stands.**
- **Migration checksums:**
  - `0055_auth_session/migration.sql`: `021dd90dd5a80eae705c3dd7f7d960e17980e46c5d43f4affe758291865f47b0`, unchanged since `5d8a16c`;
  - MP-1 `0056_my_people_foundation/migration.sql` at `72ca7b9`: `4f40cee79aa29f43e370b34b23b1ee54534f63ddea6b5663fd0728291bd95dc2`.

## 6. CI stability finding and R1 failure evidence

- **R1 run 45998039990 final result:** 6 of 7 jobs passed. Database migration validation failed at step 11, the MCP I2b-S2 staging-blocker test, with `stored 29 vs 30 attributed contributions` on three shards. It was **not rerun**.
- **Recorded separately** in `CI_STABILITY_FINDING_MCP_I2B_S2.md`. The absence of MCP changes **supports, but does not establish**, an unrelated intermittent failure. No MCP code, test, harness or migration was touched.
- **Original evidence preserved** in `r1-ci-failure-45998039990/` (job log, failure summary, final run results, `failure-evidence.sha256`, verified OK). The same files remain in R1's evidence directory.
- **Rule for the R2 run:** if the MCP failure recurs, stop and report, with no rerun.

## 7. Evidence and checksums

`AURA_AUTH_SESSION_01_I1_R2_EVIDENCE/` contains:
- `before/` and `after/`;
- `controls/`;
- `mutations/`;
- `regression/`;
- `ephemeris-replay/`;
- `mp1-compat/`;
- `r1-ci-failure-45998039990/`;
- `CI_STABILITY_FINDING_MCP_I2B_S2.md`;
- `repro/`;
- `SHA256SUMS`, covering every committed file.

The final CI addendum (`final-ci-addendum.txt` plus its `.sha256`) is written **uncommitted**, and only after every job passes.

## 8. Restrictions observed

**Not done:**
- no I2 or I3, no MCP correction, no migration or schema change, no new dependency;
- no branch sync, deliberate CI rerun, merge, deployment or Production access;
- no credential rotation and no activation;
- the draft status, auto-merge off and auto-fix off are unchanged.

**Used:** synthetic users and disposable loopback databases only.
