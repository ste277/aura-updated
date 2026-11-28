# AURA-AUTH-SESSION-01-I1 R3 — Transaction Binding and Single-Use Release: Independent Verification Handover (39237 → 39238)

**Date:** 2026-11-27 · **PR:** [#401](https://github.com/ste277/aura-updated/pull/401), still a draft, with auto-merge and auto-fix off. Production stays on REL-05.

**Revisions:**
- reviewed head: `696e584e3cd4c0c65aacaee51cfa2dbdd2e429f2` (39236 NO-GO), integration `fc63ea3`;
- R3: **one commit** on top of `696e584`;
- main `73cea7dc409e2740b4474695e248338f87c374c0`, unchanged since 71044, so CI-10 stays included and no re-synchronization was needed;
- MP-1 tested at `7b8d0fd5a0cb33302297fe752f5005d27aaad16d`.

The R3 head, the integration commit and tree, and the CI results are in the uncommitted final addendum. It is written only after all CI passes.

## 0. Evidence availability (recorded, not claimed as verified)

- `AURA_AUTH_SESSION_01_I1_R2_INDEPENDENT_DISPOSITION_39236.md` and `AURA_AUTH_SESSION_01_I1_R2_INDEPENDENT_EVIDENCE_39236/` are **not available** to this work. They are not in the repository, any worktree, the PR comments or the scratchpad. So **their checksums could not be verified** and **the exact independent witnesses could not be recovered**.
- **The two supplemental checks blocked during independent verification are unknown to this work.** They are recorded as unavailable.
- Both defects were therefore **reconstructed independently from the 39237 description** and reproduced on unchanged R2 before any change (§2). Compare against the original witnesses when available.
- Earlier limitations are retained: the 39232 disposition was unavailable, and mutation M3 is detected only by the controlled-clock tests.

## 1. Transaction ownership assessment

**Can R2's caller-owned abstraction bind an acknowledged COMMIT to its transaction?** **No.** R2 checks first and acts second: a separate pre-check (`txid_current_if_assigned() IS NOT NULL` plus "row visible") is followed by a separate `COMMIT`.

| Concern | R2 behaviour | Why |
|---|---|---|
| Transaction replacement (the caller's own COMMIT, then BEGIN) | **authorized** | the check only asks whether *any* transaction is open and the row is visible |
| Rollback then BEGIN plus re-insert of the same `idHash` | **authorized** | the row is visible in the *new* transaction |
| Connection reuse (same backend, later transaction) | **authorized** | the connection is the same; it is a different transaction |
| Overlapping caller operations on the same client | **authorized a different transaction** | the caller's queued COMMIT/BEGIN run *between* the check and the helper's COMMIT, so the helper's COMMIT ends the replacement transaction |
| Ambiguous COMMIT, then a substitute transaction | **raw id released** | a bare caller COMMIT never passes through the helper, so the provisional remains "open" |

The table shows R2 relied on things that do not identify a transaction: connection identity, account, row presence, a COMMIT reply, and a check that can go stale.

**R3's adjustment is the smallest safe change, and the approved contract is not materially changed.** The caller still owns BEGIN, every statement, when to commit, and any ROLLBACK, and R2 already required committing through the helper. The two changes:
1. **Identify the originating transaction.** `createAuthSessionInTransaction` adds `RETURNING txid_current()`. That is the 64-bit, epoch-qualified id of the transaction whose INSERT created the row, and it is kept privately with the provisional session.
2. **Make check and COMMIT atomic.** `commitAuthSessionTransaction` sends **one simple-query message**:
   `DO $$ … IF txid_current_if_assigned() IS DISTINCT FROM <txid> OR <row with idHash+userId not visible> THEN RAISE … SQLSTATE 'P0A01' … $$; COMMIT`.
   PostgreSQL executes the statements of one message in order, with nothing from the same connection interleaved, and **skips COMMIT if the check raises**. The check cannot go stale, because no statement can run between it and the COMMIT. A transaction id is never reused (it carries the 64-bit epoch), so a replaced or reused transaction can't match.

**Behaviour change, documented:** after `transaction_mismatch` or `aborted_transaction`, the caller's transaction is left aborted, and the **caller must ROLLBACK** it. R2's separate COMMIT used to end an aborted transaction. One R1Db check (B4, aborted) was adapted to end its own transaction.

## 2. Witnesses on unchanged R2, and R3 (`repro/reproR3Witnesses.ts`)

Both versions ran the identical script, against a real disposable PostgreSQL with the existing loopback fault proxy. Ids in the recorded JSON are redacted.

| Witness | R2 `696e584` | R3 |
|---|---|---|
| A1 caller commits T1, opens T2, then calls the helper | committed, **1 raw-id release** | `transaction_mismatch`, **0** |
| **A2 T1's COMMIT ambiguous (row persisted), substitute T2 on a new connection** | committed, **1 release: raw id after an ambiguous commit** | `transaction_mismatch`, **0** |
| A3 rollback, then T2 re-inserts the same `idHash` | committed, **1** | `transaction_mismatch`, **0** |
| A4 caller COMMIT/BEGIN queued *behind* the helper | committed; **authorization not from the originating transaction** (the helper's COMMIT ended T2) | committed **from T1 itself** (the caller's COMMIT then saw "no transaction in progress"); 1 release, correct |
| A4b caller COMMIT/BEGIN/write queued *before* the helper | committed, **1** | `transaction_mismatch`, **0** |
| B overlapping release ×2 / ×10 | **2 / 10 releases** | **1 / 1** |

## 3. Root causes and changed files

**Root causes:**
- **(A)** The authorization depended on a check made *separately* from the COMMIT, and that check didn't identify *which* transaction created the row.
- **(B)** `releaseCommittedAuthSession` removed the authorization only **after** its `await` read-back, so every overlapping call passed validation.

**Changed files:**
- `apps/web/lib/authSessionStore.ts` (the only implementation file);
- `test/authSessionR3Db.test.ts` (new);
- `test/authSessionContract.test.ts` and `test/authSessionR1Db.test.ts`, with expectations updated for the single message;
- `.github/workflows/ci.yml` (+1 step);
- ticket, design §2.4, R2 handover ("Corrected in R3" notes) and this handover.

**Unchanged against `696e584`** (`git diff` empty):
- `authSessionDb.ts`, which holds the deadline, retry, budgets and pool;
- `authSessionToken.ts` and `sessionErrors.ts`;
- migration 0055 and `schema.prisma`;
- the dormancy and controlled-clock tests;
- `auth.ts`, `session.ts`, `app/`, `pages/`, `components/`, `packages/`, `apps/mcp`;
- every `package.json` and lockfile.

## 4. Transaction-binding contract and single-use lifecycle

**Binding.** A `CommitAuthorization` exists **only** when PostgreSQL acknowledged the COMMIT in the **same message** as a check proving three things:
- the current transaction is exactly the one whose INSERT created the provisional session (same `txid`);
- that transaction still holds the row;
- the row has the same `idHash` **and** `userId`.

Failed checks map to outcomes as follows. In every case except `committed`, the raw id is destroyed and the provisional can never be committed again.

| Check result | Outcome |
|---|---|
| substitution, stale state, mismatched operation, or transition from outside the helper | `rolled_back` (`transaction_mismatch`, SQLSTATE P0A01) |
| aborted transaction | `aborted_transaction` (25P02) |
| failed at commit | `rejected_at_commit` (23 / 25 / 40) |
| connection lost, deadline, or unexpected reply | `ambiguous` |

**Single-use lifecycle** (`releaseCommittedAuthSession`):
1. Validate that the authorization was issued by an acknowledged COMMIT.
2. **Consume it synchronously, before the first `await`.** JavaScript runs this to completion, so an overlapping call finds no entry and is refused.
3. Read the row back on an independent connection (bounded lookup).
4. Return the raw id **only** for a live, matching row (idHash, userId, not revoked, not expired). Otherwise return null.

If the read-back fails or is uncertain, it **throws**, and the authorization is **never restored**. That fails closed: no session, and the user signs in again. This deliberately tightens R2, which allowed another attempt after an unavailable read-back.

**Ambiguous COMMIT, preserved from R2.** An ambiguous COMMIT permanently destroys the raw id. `classifyAmbiguousCommit` can only return `committed_undisclosed` or `not_committed`. With R3, a later substitute transaction can't revive it either (witness A2, test 14).

## 5. Deterministic concurrency and PostgreSQL durability (`authSessionR3Db.test.ts`, **24/24**)

Every check asserts the **exact** number of raw-id releases. Ordering is deterministic: node-pg sends a client's queries in order, synchronous JavaScript runs to completion, and an explicit barrier holds the read-back connection.

| # | Case | Releases |
|---|---|---|
| 1 | originating transaction + acknowledged COMMIT | **1** (sid hashes to the row) |
| 2 | transaction replaced before COMMIT | **0**; permanently dead |
| 3 | rollback then another transaction / plus mismatched re-insert | **0** / **0** |
| 4a | caller COMMIT/BEGIN queued behind the helper | **1**, proven to be T1's own COMMIT ("no transaction in progress" notice) |
| 4b | caller COMMIT/BEGIN/write queued before the helper | **0** |
| 5 | provisional P2 presented with another transaction | **0** (that transaction left aborted, 25P02); a correctly bound provisional still gives **1** |
| 6 | connection reuse (same backend pid, later transaction) | **0** |
| 7 | forged / copied / transferred authorization (spread, prototype, JSON, `structuredClone`, re-pointed) | **0** for all 5; the genuine one gives **1** |
| 8 | sequential reuse | **1**, then refused |
| 9 / 10 | 2 / 25 overlapping release calls | **exactly 1** each |
| 11 | read-back held at a barrier while 5 more calls overlap | the 5 are refused **before** the read-back completes, with only one lookup started; **1** |
| 12a / 12b | read-back failure, confirmed (ended pool) / uncertain (black-holed answer) | **0**; never restored (retry refused) |
| 13 | revoked / expired / missing row | **0** each (null once, then refused) |
| 14 | ambiguous COMMIT that persisted the row, then a substitute transaction | **0**; the substitute is refused |
| 15 | repeated classification | `committed_undisclosed` ×3, never material |

**Other durability suites:** R1Db **42/42** (parts A, B, C) and store DB **50/50** pass. The fault-injection tests B5–B8 confirm the R2 ambiguous-COMMIT protections still hold under R3.

## 6. Negative controls

**Newly executed on R3.** `mutations/mutation-results.json` covers 14 mutations; each mutated file was restored and its sha256 verified identical. The compile-time controls are in `controls/compile-time-controls-r3.txt`.

| Control | Caught by |
|---|---|
| **N1** authorization for a substituted transaction (binding loosened to "any transaction") | R3Db 2 and others |
| **N2** originating-transaction binding bypassed | R3Db 2 and others; R1Db B4 |
| **N3** non-atomic consumption (consumed after the read-back) | R3Db 9 (2 releases) and others |
| **N4** authorization reuse | R3Db 8; R1Db B2 |
| **N5** release authority restored after an ambiguous COMMIT | the R3Db run stops at test 14 with an unexpected TypeError on the restored provisional, before the explicit substitution assertion prints |
| Historical **M1–M9** re-executed on R3 | all caught (M3 by the controlled-clock tests only, as before) |
| **M10** (R2's pre-COMMIT check removed) | retired, because the check no longer exists; superseded by N1 and N2 |
| **Compile time** | all **10/10** `@ts-expect-error` assertions fail to compile when removed |

**Historical evidence, reviewed and not re-run here:** R1 M1–M6 and R2 M1–M10 results (R1 and R2 evidence directories), R2's compile-time controls, and all earlier CI-failure evidence.

## 7. Existing regression results (local, CI layout, disposable PostgreSQL 16)

| Suite | Result |
|---|---|
| token | 68 |
| contract | 21 |
| deadline | 27 |
| dormancy | 33 |
| store DB | 50 |
| R1 DB | 42 |
| R3 DB | 24 |
| PREF-01 / MR3 / INS-01 guards; fresh-overlap and manual-writer architecture guards | all passed |
| AUTH-01 / SEC-01 / AUTH-02 | 24 / 47 / 136 checks, all passed |
| **Weekly Plan Review** (CI-10 fixture, run during IST evening) | passed |

- **Full Ephemeris job replay on R3:** 246/246.
- **MP-1 `7b8d0fd`, both orders** (0055 then 0056, and 0056 then 0055):
  - real `migrate deploy` succeeds, `status` reports 56 up to date, and the ledger counts 56;
  - all pass: I1 store DB 50, R1 DB 42, R3 DB 24, `birthDateWritersDb`, `myPeopleDb`, switch-rollback, MP-1 R1/R2/R3/R4 and the legacy editor.
- The same three guard conflicts appeared (`mp1-compat/union-resolution.diff`). **The second-merge reconciliation requirement with PR #400 stands.**
- **Migration checksums:**
  - 0055: `021dd90dd5a80eae705c3dd7f7d960e17980e46c5d43f4affe758291865f47b0`, unchanged;
  - 0056 at `7b8d0fd`: `4f40cee79aa29f43e370b34b23b1ee54534f63ddea6b5663fd0728291bd95dc2`, identical to `72ca7b9`.

## 8. Remaining limitations

- **The authorization is an in-process object** held in a module-private `WeakMap`. It can't be serialized or transferred, by design. The single-use guarantee relies on JavaScript's run-to-completion semantics within one process. Worker threads don't share the map, so no cross-thread authorization is possible.
- **The binding relies on PostgreSQL itself:** the single-message semantics of simple-query statements, `txid_current()` / `txid_current_if_assigned()`, and `DO` (PL/pgSQL, installed by default). A statement-mode pooler that splits multi-statement messages is unsupported; transaction mode is fine.
- **After a mismatch or abort,** the caller must ROLLBACK its own transaction. This is documented in the store.
- **Unavailable evidence:** the 39236 disposition and evidence, and the two blocked supplemental checks (§0).
- **CI debt:** CI-DEBT-11 and CI-DEBT-13 remain open; CI-DEBT-12 is closed under CI-10.

## 9. Restrictions observed

**Not done:**
- no I2 integration;
- no unrelated refactoring, dependency, schema or migration change;
- no merge, deployment, Production access, credential rotation or activation;
- the draft status, auto-merge off and auto-fix off are unchanged.

**Used:** synthetic users and disposable loopback databases only.
