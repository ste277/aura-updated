# AURA-MCP-CI-02 (ticket 39410): I2b-S2 required-check investigation

- **PR:** #397, branch `test/aura-mcp-ci-02-i2b-s2-deadlock`.
  - Round 1: commit `1dd2ea6` (on `7b80f98`).
  - Round 2: `main` merged in at `3feff03` (includes CI-07 #395 and MCP-CI-01 #394), then the COMMIT-refusal correction (`7c5120f`).
  - Round 3: closes the ticket-39419 independent findings on `7c5120f` (§6).
  - The exact final head, the integration merge ref and the CI run are recorded in the PR description. A commit cannot contain its own CI result.
- **Scope:** **test-only and documentation-only.**
  - Changed files: `test/mcpOAuthStagingBlockersDb.test.ts`, this report, and section 6 of `AURA_MCP_CI_01_TEST_STABILIZATION_REPORT.md` (the deferred CI-01 merge record).
  - Not changed: runtime limiter logic, production deadlines, timeouts, capacity limits, database configuration, CI workflow, branch protection.
  - MCP stays disabled. Nothing was deployed.
- **Evidence:** `AURA_MCP_CI_02_EVIDENCE/` at the repo root of the owner's checkout (untracked, with `SHA256SUMS`). The bundle verified for round 2 had 61 files (`SHA256SUMS` sha256 `74740b49…`). Round 3 adds `round3/`. The final file count and checksum are in the PR description.

## 1. Failure 1: "I2b-1 deadlocks: … all admitted, none failed"

**Occurrences:**
- run 45635380561 (PR #395, `ea3f0f8`), job 139279298521;
- run 45640197925 (PR #396, `e78254a`), job 139296411524.

In both, the check that follows it reported `Postgres reports 0 deadlocks`. **This was an assertion failure, not a PostgreSQL deadlock error.**

**Root cause: the test's expectation was wrong.**
- All 400 decisions share the rows `user:dl-a` and `client:dl-b`. The row locks serialize them by design: one sorted `SELECT … ORDER BY key FOR UPDATE`.
- All 400 ran under the production 1250 ms decision deadline, and every deadline started at the same instant.
- On a slower runner, the tail of the queue is shed as `unavailable` with cause `deadline`. That is fail-closed shedding.

**Reproduction** (disposable PG 16.14, 3 instances × 6 connections, production defaults; `repro/run1.jsonl`):

| Injected delay per statement | Result |
|---|---|
| +0 / +1 / +2 ms | all 400 admitted (216 / 804 / 1196 ms) |
| +3 ms | 295 admitted, 104 `deadline`, 1 `commit_timeout`; no server SQLSTATE; 0 deadlocks |
| +6 ms | 166 admitted, 233 `deadline`, 1 `commit_timeout`; 0 deadlocks |

**Not a runtime regression** (`repro/perf-by-commit.txt`):
- Every version runs about 3.2 statements per decision, at the same speed: S2 `171ec86`, S8 `b2e0f8c`, S11 `fdcbfab` and `7b80f98`.
- At +2 ms per statement, every version takes 1.06–1.25 s, so the check has had almost no headroom since it was added.

**The old oracle was blind.** Production uses `lock_timeout` 1000 ms, which is no longer than `deadlock_timeout` (1 s). Under those settings, a real opposite-order deadlock was cancelled as `55P03` before the detector ran: 5 of 5 times, with the `pg_stat_database.deadlocks` delta at 0. With `lock_timeout` 5000 ms, the same deadlock gives `40P01` and delta +1.

**Correction:**
- **(a) Deadlock property under an explicit budget.**
  - Budget: 30 s deadline, `lock_timeout` 5000 ms (a precondition asserts it is at least 2 × `deadlock_timeout`), statement timeout 6000 ms.
  - Asserts: all 400 admitted; exact hot-row counts (400 / 400 / 200 + 200); no SQLSTATE of any kind underneath the limiter; the deadlock counter delta is 0, read after the backends exit.
- **(b) Negative control.** A real opposite-order deadlock under the same budget gives `40P01` and the counter goes up by at least 1.
- **(c) Deterministic reproduction of the slow runner.** Production defaults, +6 ms per statement: at least 2.4 s of serialized lock holds against a 1250 ms deadline.
  - The pre-CI-02 "all admitted" assertion **fails** here.
  - Every shortfall is either deadline shedding (`deadline` / `commit_timeout` / `commit_late`) or a server-bounded wait.
  - No `40P01` and 0 new deadlocks.
  - `admitted ≤ counted ≤ admitted + ambiguous`.

### 1a. Round-2 finding: lock-wait starvation under production timeouts (observation; no runtime change)

**What happened:** on the first round-2 run, the round-1 (c) rule "no server SQLSTATE" failed once. One DECIDE was cancelled with `57014` after waiting for the full 1000 ms `statement_timeout`.

**Measurement** (`round2/statement_timeout_starvation_probe_25runs.txt`):
- 6 of 25 runs had 1–3 such cancellations.
- Each was a DECIDE sent early (60–236 ms) that waited 1000–1003 ms, while about 160 later decisions were granted the lock.
- PostgreSQL row-lock waits are not strictly first-in, first-out, so an early waiter can be starved.
- The limiter fails closed: `57014` becomes cause `driver`, which the route answers with 503.
- With the corrected rule, 8 of 8 runs passed; 5 of those 8 had starved waits, so the old rule would have failed 5 of 8.

**Correction to (c), a check added in this PR and not yet merged:** each `driver` answer must be matched one-for-one by a server bounded-wait SQLSTATE (`57014` / `55P03`, the limiter's own `SET LOCAL` bounds). Any other SQLSTATE, any `40P01` or any new deadlock still fails. Deadlock *detection* belongs to (a), whose budget lets the detector run.

**Runtime observation (for the owner; not changed, not a safety defect):**
- Under hot-key contention, a production decision can be cancelled by `statement_timeout` and is labelled `driver`, which reads as infrastructure, not shedding.
- The CI-01 gate A treats `driver` as unexpected.
- Gate A's 2000-decision flood spreads load over 16 shards plus per-address keys, so this has not been observed there. It is a possible rare source of gate-A noise. Any change to the classification is a runtime decision.

## 2. Failure 2: "I2b-1 explicit COMMIT failure … nothing counted for it"

**Occurrence:** PR #396 run 45783279199 (`0c714c24`, before `3feff03`), job 139783693726, archived at `ci/run45783279199_job139783693726.log`.

```
admitted 365, commit_failed 40, commit_timeout 8, deadline 1585, 429 2
counted 373  (= 365 + 8)
```

**Root cause: the test's expectation was wrong.**
- The assertion required the stored count to equal the admitted count.
- A COMMIT that the server confirms after the limiter's 1250 ms deadline is counted but not admitted, because the limiter has already answered `commit_timeout`. That is by design: it errs toward deny and only ever over-counts.
- **What the log establishes:** 8 `commit_timeout` responses, and 8 more stored increments than admissions (373 − 365).
- **What it does not establish:** that those 8 increments came from those 8 transactions. The CI log has no transaction-level evidence, so the attribution is consistent with the counts but not proven for that run.
- **Mechanism:** a COMMIT that lands but is acknowledged after the deadline is counted and not admitted. It was reproduced independently and deterministically, with transaction-level attribution (§6c).
- The same assertion is still on main after `3feff03`.

**Correction: independent wire-level ground truth.** The faulty test pool records, per request, what happened to its COMMIT on the connection:
- `acked`: the server confirmed it; it landed.
- `refused`: rolled back; nothing landed.
- `unknown`: sent, but the connection failed or was destroyed before an answer.

The state is recorded before each COMMIT or ROLLBACK is sent, so a destroyed connection cannot leave it blank. `commitAccounting()` then enforces:

- **Per bucket:** `admitted ≤ acked ≤ counted ≤ acked + unknown`.
  - Equivalently: `counted ≥ admitted`, and `counted ≤ admitted + ambiguous`, where ambiguous = acked-but-late + unknown.
  - Explicitly refused COMMITs add nothing.
  - Under-counts, unexplained over-counts and duplicate increments fall outside the bound.
- **Per request:**
  - an admission needs a confirmed COMMIT;
  - an explicitly refused COMMIT is never admitted;
  - `commit_failed` only appears with an explicit refusal;
  - an ambiguous label only appears where a COMMIT was really attempted. A refused COMMIT answered after the deadline is legitimately `commit_timeout`: the limiter never learned the outcome.
- **Capacity:** every shard stays at or below 30, and the total at or below G (480).

**Coverage:**
- **Synthetic, deterministic:** refused COMMITs add nothing (counted 2 passes, 3 fails); late COMMITs within the bound (counted 4 and 5 pass, 3 and 6 fail); duplicate increment fails; refused reported as admitted fails; admitted with an unknown or unsent COMMIT fails; misclassification fails; refused-then-late adds nothing (0 passes, 1 fails); over-capacity fails.
- **Live flood:** the existing refusal flood is judged against the wire record per shard, alongside the existing "classified `commit_failed`, FAILS A".
- **Deterministic reproduction of run 45783279199:** on each of 3 instances, the 1st COMMIT is explicitly refused and the 2nd lands but is acknowledged 250 ms after the deadline. Result: 3 `commit_failed`, all refused, none counted; 3 late commits landed as `commit_timeout`; counted = admitted + 3, so the old assertion **fails**; the wire bound passes.

## 3. Mutation checks (runtime edited locally, never committed; `round2/mutations/`)

| Mutation | Result |
|---|---|
| Unsorted keys only (single `ORDER BY … FOR UPDATE` kept) | 110/110 pass. The SQL still locks in sorted order, a second layer of protection |
| Per-key locks in caller order | (a) fails with `40P01` and a counter delta of 116 |
| Admit on an explicit COMMIT refusal | Wire accounting fails ("unsafe admission"). The old `counted === admitted` assertion would have **passed**: 57 counted = 57 admitted |
| Double increment | Wire bound fails ("over-count"), as do the CI-01 A/B accounting checks |

**Round 3, all four re-run on the final test code (131 checks; `round3/mutations/`):**

| Mutation | Result |
|---|---|
| Per-key locks in caller order | (a) fails: `40P01` / `55P03`, deadlock counter delta 48 |
| Unsorted keys only | 131/131 pass (same reason as above) |
| Admit on an explicit COMMIT refusal | Wire bound **and** attribution fail ("unsafe admission"); the deterministic reproduction fails |
| Double increment | Attribution fails (stored != attributed, duplicate), plus the wire bound, the live attribution controls and the CI-01 A/B checks |

## 4. Verification (local, disposable PG 16, `127.0.0.1:55912`, serial)

- **Round 3 (final test code):** `mcpOAuthStagingBlockersDb` **131/131**, 8 of 8 runs. That is main's 87 checks plus 44 from CI-02: 8 in round 1, 15 in round 2, 21 in round 3.
  - 4 of the 8 runs had live `driver` refusals, each attributed to its own `57014`.
  - The contribution trigger, function and table were verified absent after the run.
  - Every DB-job suite in CI order: Postgres 36, StorageProtection 42, **StagingBlockers 131**, S4 13, S6 14, S8 11, S10 21, S11 19, S12 15.
- **Round 2:** `mcpOAuthStagingBlockersDb` 110/110, 8 of 8 runs.
- Offline: StagingBlockers 52/52.
- Round 1 (on `7b80f98`): 53/53, 5 of 5 runs plus 2 of 2 under CPU contention.
- Round-1 integration onto `3feff03`: 95/95, 3 of 3 runs.
- No CI reruns. No assertion was removed to get a pass. The only rule relaxed is round 1's own (c) "no SQLSTATE" (§1a). Since round 3, every relaxation is matched *per request* to that request's own bounded-wait code (§6a).

## 5. Not changed or out of scope

- PR #393, #394 and #395 are not modified.
- MCP-CI-01 findings are not reopened. The CI-01 gates A/B/C are untouched; the round-2 change only touches the S2 fault-injection pool and the refusal check.
- No Production access, no deployment, no MCP activation.
- Recommended independent focus:
  - the soundness of the wire ground truth in `faultyPool`;
  - the bound in `commitAccounting`;
  - the bounded-wait allowance in (c), and the §1a runtime observation.

## 6. Round 3: ticket-39419 independent findings on `7c5120f`

**Disposition from the review:** the original deadlock failure is CLOSED, and no runtime safety violation was demonstrated. Three test-harness attribution witnesses remained open.

**Preserved review evidence:** the reviewer's suite logs and CI logs are in `AuraEvidence/AURA_MCP_CI_02_39419_INDEPENDENT_REVIEW_PRESERVED_20261126/`, with SHA256SUMS. The reviewer's three probe scripts were **not found on disk**. Each witness was therefore reconstructed against the reviewed head's code, extracted verbatim with `sed` from `git show 7c5120f`: `round3/witness-reconstructions/`. On 7c5120f all three reproduce (`witness_before_on_7c5120f.json`).

**a. Request-specific timeout attribution** (witness: a `57014` on a deadline-refused request satisfied an unrelated `driver` refusal under count matching).
- Each SQLSTATE now carries its request identity (`decideAls`) through the test pool.
- `timeoutAttribution()` checks:
  - every code belongs to an identified request;
  - `40P01`, or any code other than `57014` / `55P03`, fails;
  - a bounded-wait code is allowed only on a request that was itself safely refused;
  - every `driver` refusal needs a bounded-wait code of its own.
- The exact witness is a regression check: the previous count matching accepts it, the new check rejects it. Three further synthetic checks cover the other rules.

**b. Deterministic late-COMMIT injection** (witness: the injection decision read a shared counter *after* awaiting the COMMIT, so with concurrent COMMITs zero were delayed).
- The COMMIT ordinal and every injection decision are now fixed at submission, before any await.
- Injections are counted (`injected.refused/late/duplicate/lostRollback`).
- A fake-client self-test, with no database, runs 3 concurrent COMMITs with in-order and reverse acknowledgements. In both, exactly the 2nd submitted COMMIT is delayed, the 1st is refused and the 3rd is untouched.
- A missing injection makes the exact-count check fail.
- The live reproduction asserts per instance: refused ordinals `[1]`, late `[2]`.

**c. Independent transaction attribution** (witness: an unknown outcome could hide a duplicate increment under `counted ≤ acked + unknown`).
- **Instrumentation:** a test-only `AFTER INSERT OR UPDATE` row trigger on the limiter table writes `(txid, request tag, key, delta)` into `ci02_txn_contrib` inside the limiter's own transaction. A row therefore exists if and only if that transaction committed.
- **Request tag:** `SET LOCAL aura_test.req`, appended by the test pool to the limiter's BEGIN (no extra round trip).
- **Scope:** installed only around the COMMIT scenarios and dropped afterwards; verified that no trigger, function or table remains. Disposable database only: no migration, Production schema or runtime change.
- **`attribution()` resolves every request** as one of: confirmed; rejected; committed with a late acknowledgement; committed with a lost acknowledgement; unknown acknowledgement that did not commit; or no COMMIT.
- **It requires:**
  - at most one contribution per request (no duplicates);
  - stored == attributed per shard, exactly, with no aggregate slack;
  - the shard limit and global capacity are respected;
  - admissions are confirmed commits;
  - explicit rejections contributed nothing;
  - a committed but unadmitted request carries an ambiguous label;
  - no contribution is unresolved (no request tag).
- **Definitive server rejections:** a COMMIT that throws a server SQLSTATE is now `refused`, not `unknown`.
- **Exact witness:** one confirmed transaction increments twice, and another acknowledgement is unknown and never commits. Stored is 2. The previous bound accepts it; attribution rejects it. This is checked both synthetically and live, with the injection selected by request identity.
- **Live positive controls:**
  - lost-acknowledgement flood: 47 committed with the acknowledgement lost, all resolved;
  - refusal flood: every rejection contributed nothing;
  - deterministic late COMMITs: exactly 3 `committed_ack_late`;
  - unknown acknowledgement that never committed: resolved as not committed.
- 10 synthetic attribution fixtures in total.

**Runtime observation, unchanged, for staging validation:** under hot-key contention a production decision can be cancelled by `statement_timeout` (`57014`) and is classified `driver`, not shedding (§1a). This is recorded for V-series staging validation. The classification stays as it is.
