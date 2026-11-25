# AURA-MCP-CI-01: stabilize the S8, S10 and S12 regression tests

- **Base:** main `1605355f2bd289cb8f42e50ecd28f7522f3977da` (PR #390). **PR:** #394, branch `test/aura-mcp-ci-01-stabilize-s8-s12`.
- **Scope:** **test-only.** Changed: `test/mcpOAuthStagingBlockersDb.test.ts`, `test/mcpOAuthS8.test.ts` and `test/mcpOAuthS10.test.ts`.
  - No change to the limiter, HMAC, authentication, secret policy, deadlines, migrations, dependencies or configuration.
  - MCP stays disabled.
  - The post-merge evidence bundle (`AURA_MCP_02_I2B_S12_FINAL_INDEPENDENT_REVIEW/post-merge-ci/`) is unchanged.

## 1. S12 aggregate limiter checks: separated responsibilities

### History
- **S12 gate** (failed on main, run 45444221976 attempt 1: 476 / 477 / 480): the floor on **admissions** was min(G, capacity / 2), with capacity from a **sequential single-connection** control. A fast control (0.43 ms) saturated the floor at exactly G = 480 while the runner was slow under the concurrent flood (1,296 ms).
- **CI-01 v1** (PR heads `02d408cf` and `2f341bf0`): a concurrent bracketing control, with the floor on **completed** decisions, min(2,000, capacity / 2), using a fixed K = 2.5. CI then measured healthy limiter/control ratios up to **4.4**. In one run (45588327851, healthy #3) the controls were 252 / 227 ms and the floor 1,984, the flood took 1,109 ms, and it passed only because the flood beat the deadline. The gate still relied on a fixed timing ratio for correctness.

### Final design
No single timing ratio decides correctness.

**A. Safety and production-deadline enforcement.** 2,000 decisions; production deadline 1,250 ms, unchanged; application pool bounds. Timing-free invariants only:
- 0 unexpected causes (checkout, driver, internal, `commit_failed`, `commit_lost`);
- admitted ≤ counted ≤ G, with any over-count explained by ambiguous or late COMMITs;
- **exact per-shard accounting:** decision i goes to shard i mod 16; for every shard, admitted = min(30, completed), and a 429 only on a full shard;
- **the deadline is enforced:** every decision is answered within 1,250 ms + 500 ms of scheduling slack, and no admission lands later than 1,250 ms + 250 ms;
- **liveness:** at least one admission.

Shedding under load is legitimate here, so A has **no availability floor**.

**B. Availability and exact accounting** (extended budget, deterministic):
- exactly G = 480 admitted;
- all 16 shards at 30;
- only 429s;
- exact per-shard accounting.

**C. Performance regression** (extended budget):
- **Measurement:** the limiter flood is compared with a **control flood** of the same shape (3 × 5 connections, 2,000 units of 4 round trips, 16 hot advisory keys; no limiter code, no table), run immediately **before and after** it.
- **Ratio:** limiterMs / max(control before, control after).
- **Pass condition:** the **best of 3 paired trials** must be **≤ R_MAX = 8**, and every trial must **decide all 2,000** requests.
- **Why best of 3:** persistent (genuine) degradation fails every trial; a transient environmental slowdown cannot.
- **Why R_MAX = 8:** about 2× the worst healthy ratio seen anywhere (4.4 on CI), and far below the injected degradation (best ratio 44–66 locally).
- C's limiter floods use a long pool-checkout timeout, matching the controls. **Found and fixed during this work:** with the application's 2 s checkout timeout, a slow flood ended at about 2,050 ms in `checkout` failures, capping the ratio near 2,050 / control. On CI's slower controls that could have hidden real degradation.

**ENV. Environment check:** a control flood slower than **5,000 ms** (4× the deadline) means the environment is unusably slow, and the run **fails**. It never passes vacuously.

### Separation of assertions

| Concern | Where | Timing-dependent? |
|---|---|---|
| Fail-closed, cause classification, ambiguous-COMMIT accounting, admitted ≤ counted ≤ G, shard-specific 429 validation | A (and B) | No |
| Production-deadline enforcement (answers bounded, no late admission) | A | Only through a fixed scheduling slack, not a throughput ratio |
| Availability (exactly G, all shards full) | B | No (extended budget) |
| Limiter performance regression | C | Yes: a ratio, best of 3, with large separation |
| Environment usability | ENV | Yes: an absolute bound |

### Residual: reproduction and correction
The deterministic scenario **"fast controls, then a healthy limiter flood under temporary contention"** applies +2 ms per statement only to the production flood, and +3 ms to one of the three C trials; the controls stay fast.
- **Reproduced:** on the same runs, the CI-01 v1 gate would **fail**. The floor was 2,000 because the controls were fast, while completed was 1,474–1,650 across 6 runs.
- **Corrected:** A passes, since the shedding is classified as `deadline`, the deadline is enforced and accounting is exact. B passes. C passes: the contended trial's ratio is 23–29, the other two 1.95–2.75.
- **Distinguished from genuine degradation:** limiter-only +10 ms per statement in every limiter flood **fails C** (all trials 44–80). A stays safe for both scenarios, with exact accounting.

### Results (local, `max_connections = 100`, 3 runs of the final head, 53/53 each)

| Scenario | A | C trial ratios (control ms, limiter ms) | C best | Verdict |
|---|---|---|---|---|
| Healthy #1 / #2 (6 samples) | pass; flood 163–336 ms, 480 / 480 | 1.85–3.34 (68–158 ms, 179–341 ms) | 1.85–2.34 | pass |
| Shared slowdown +2 ms | pass; flood about 1,266 ms (shedding), 480 / 480 | 1.19–1.29 (1,273–1,353, 1,534–1,738) | 1.19 | pass |
| Residual (fast controls, contended healthy flood) | pass; deadline sheds classified, 480 / 480 | contended trial 23.6–28.3; others 1.95–2.75 | 1.95–2.28 | pass |
| **Limiter-only degradation** (+10 ms) | pass (safe, exact) | 44.8–80.5 (81–145, 6,419–6,655) | **44.8–65.9** | **fail** (detected) |
| Unusably slow environment (control +12 ms) | — | control above 5,000 ms | — | **fail** |

**Negative controls**, all failing A as required:
- injected pre-COMMIT driver faults (`driver`);
- post-send connection loss (`commit_lost`; counted ≤ G);
- explicit COMMIT refusal (`commit_failed`; nothing counted);
- "0 admitted, 2,000 unavailable";
- all shed by the deadline (liveness);
- a limiter answering 429 to everything (refusals on shards that are not full);
- decisions answered long after the deadline (deadline not enforced).

B's exactness and per-shard accounting pass.

### Remaining limitations
- **C is a timing comparison.** Its separation is large (healthy ≤ 3.34; degraded ≥ 44), and best-of-3 absorbs one transient. A contention burst covering all three trials while sparing both bracketing controls each time would be needed to fail a healthy limiter.
- **A's deadline check uses 500 ms of scheduling slack** for event-loop lag with 2,000 pending promises. Observed maximum latencies were 1,252–1,268 ms.
- **ENV and R_MAX are absolute constants.** They are justified from measured ranges, not fitted to one CI run.

## 2. S8 address-bucket HMAC assertion (unchanged since the previous head)
- **Root cause:** a substring exclusion (`2001` / `db8`) applied to a 32-hex-character HMAC under a random key, which fails by chance on about 0.7% of runs. CI recorded `…7cdb81db…`.
- **Correction:** **exact equality** with an independently computed HMAC-SHA-256 for a fixed synthetic secret. Both the recorded CI hash and the fixed fixture reproduce the old failure. Format, key-separation and /64 checks are preserved, and wrong-key and cleartext negative controls are added.
- **Result:** 60/60 in every run.

## 3. S10 legacy-secret acceptance assertion
- **Root cause:** the test drew **fresh random** untagged hex secrets and required all 20,000 to be accepted. An untagged 16-byte hex value with no a–f letter (probability (10/16)^32 ≈ 2.9e-7, about 0.6% of runs) is refused **by policy**: it is judged as legacy text, exactly as the S8 rule did. This is not a runtime defect. A 4,000,000-sample probe found exactly one such value: `64976964540383724985906370631171`.
- **Correction** (policy unchanged):
  - Samples come from a **fixed seed** (SHA-256 of label, index and block), so the same 20,000 values are used on every run for each of 8 formats.
  - Each verdict is checked against the **documented policy**:
    - untagged hex with at least one a–f letter: accepted;
    - digits-only untagged hex: the legacy S8 rule's verdict;
    - canonical base64 / base64url: accepted.
- **Deterministic fixtures:**
  - **Reproduction:** the recorded digits-only value is **refused untagged** (format `text`), so the old "always accepted" assertion fails on it.
  - **Tagged path:** the same value is **accepted as `hex:`** (128 bits).
  - **Valid values:** 3 representative untagged hex values are accepted as `hex`.
  - **Refused values stay refused:** `aaaa…`, the balanced counting hex, a low-variety mixed-case value, and an odd-length 8-symbol hex-lexical value (the S11 overlap class).
  - **Mistagged:** hex under `base64:` is refused (`ambiguous_encoding`).
  - **Strength:** format-aware bits (128 for hex, 192 for base64url) use fixed inputs.
  - The broader malformed, weak and mistagged coverage in `mcpOAuthS12` is unchanged (84/84).
- **Result:** S10 offline 135/135 in every run.

## 4. Verification
- **All MCP suites** (`max_connections = 100`) passed:
  - offline: transport, Local 119, SecurityRegression 34, I2b 116, StagingBlockers 52, S8 60, S10 135, S11 31, S12 84;
  - DB: Postgres 36, StorageProtection 42, StagingBlockersDb 53, StoreS4 13, CodeS6 14, S8Db 11, S10Db 21, S11Db 19, S12Db 15;
  - dbIdentityGuard.
- **Repeats:** StagingBlockersDb 3/3 on the final head (and 5/5 on the earlier version of this design); S10 and S8 offline 3/3.
- **No retries** were used to hide failures.
- **Exact-head CI:** recorded in the PR description.
