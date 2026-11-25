# AURA-MCP-CI-01: stabilize the S8, S10 and S12 regression tests

- **Base:** main `1605355f2bd289cb8f42e50ecd28f7522f3977da` (PR #390). **PR:** #394, branch `test/aura-mcp-ci-01-stabilize-s8-s12`.
- **Scope:** **test-only.** Changed: `test/mcpOAuthStagingBlockersDb.test.ts`, `test/mcpOAuthS8.test.ts`, `test/mcpOAuthS10.test.ts` and (this round) `test/mcpOAuthS12.test.ts`.
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
- **exact per-shard accounting** (corrected in round 3, §1a): decision i goes to shard i mod 16; for every shard, admitted ≤ counted ≤ 30, any over-count is explained by that shard's ambiguous / late COMMITs, and a 429 is allowed only when that shard is counted at exactly 30; in aggregate, admitted ≤ counted ≤ 480;
- **the production deadline itself** is proven by a deterministic monotonic-clock test (§1a): COMMIT acknowledged at 1,249 ms admits; at 1,250 ms and 1,300 ms it is refused (`commit_late`). The live flood no longer infers admission timing from the outer clock;
- **response completion:** every decision is answered within 1,250 ms + 500 ms (event-loop allowance for response completion only; it never permits a late admission);
- **liveness:** at least one admission.

Shedding under load is legitimate here, so A has **no availability floor**.

**B. Availability and exact accounting** (extended budget, deterministic):
- exactly G = 480 admitted;
- all 16 shards at 30;
- only 429s;
- exact per-shard accounting.

**C. Performance regression** (extended budget):
- **Measurement:** the limiter flood is compared with a **control flood** of the same shape (3 × 5 connections, 2,000 units of 4 round trips, 16 hot advisory keys; no limiter code, no table), run immediately **before and after** it.
- **Ratio** (corrected in round 3, §1a): limiterMs / **median of all six controls** (before and after each of the 3 trials).
- **Pass condition:** the **best of 3 trials** must be **≤ R_MAX = 5**; **every** trial must be exactly correct (all 2,000 decided, exactly 480 admitted, all 16 shards at 30, exact per-shard accounting); and **every** control, including the bracketing controls, must pass the 5 s ENV guard.
- **Why best of 3:** persistent (genuine) degradation fails every trial; a transient environmental slowdown cannot.
- **Why R_MAX = 5:**
  - It is at least 2× the worst healthy **best-of-3** ratio observed (2.67 locally, 1.80 on CI), and above the worst healthy **single** trial anywhere (4.4).
  - The injected degradation (+10 ms per statement) measured **11.2 on CI** (controls about 530 ms) and **44–66 locally**.
  - R_MAX was first 8. CI run 45594423214 showed degradation at only 11.2 with 530 ms controls, which would be about 8 with the 746 ms controls seen in the same run. So it was **tightened** to 5, not loosened.
- C's limiter floods use a long pool-checkout timeout, matching the controls. **Found and fixed during this work:** with the application's 2 s checkout timeout, a slow flood ended at about 2,050 ms in `checkout` failures, capping the ratio near 2,050 / control. On CI's slower controls that could have hidden real degradation.

**ENV. Environment check:** a control flood slower than **5,000 ms** (4× the deadline) means the environment is unusably slow, and the run **fails**. It never passes vacuously.

### 1a. Round 3: final assertion corrections (independent review of `535822ea`)
The review found that the production limiter is correct (1,250 ms deadline independently verified) and that the remaining defects were in the **test checker**. Each defect is reproduced against a **frozen copy of the previous checker** (`prevAccounting` / `prevCheckA` / `prevC`, kept in the test file) and the corrected checker rejects it. All fixtures are deterministic (no DB, no timing).

| Defect (previous checker) | Deterministic fixture | Previous | Corrected |
|---|---|---|---|
| Admission charged to the wrong shard | decision 0 (shard 0) admitted, shard 0 counts 0, shard 1 counts 1 | accepted | **rejected** ("admission charged to another shard") |
| Shard over its limit | shard 0 counted at 31, with 429s | accepted | **rejected** ("counted 31 > limit 30") |
| 429 on a shard that is not exactly full | covered by the two fixtures above and the all-429 negative control | accepted | **rejected** ("a 429 only on an exactly full shard") |
| Admission timing inferred from the outer clock with 250 ms slack | an admission observed at 1,300 ms | accepted | outer-clock admission check **removed**; deadline proven by the clock test below |
| C: an all-429 trial among healthy trials | trials [all-429, healthy, healthy] | accepted (best trial healthy) | **rejected** (every trial must be exact) |
| C: env guard only on the pre-run control | bracketing controls at 5,001 ms | accepted | **rejected** ("control i took 5001 ms > 5000 ms") |
| C: one undecided request in a non-best trial | trial 2 with 1,999 decided | accepted | **rejected** |
| C: one slow control masks a sustained slowdown (review's case) | controls [142,120] [405,130] [102,110]; limiter 1,690 / 1,550 / 1,419 | best **3.83 → pass** | median 125 → best **11.35 → fail** |

**Preserved legitimate ambiguity:** shard 0 counted 30 with 29 admitted and 1 `commit_timeout`, then 429s, **passes** (the over-count is explained by the ambiguous COMMIT on that shard).

**Exact admission deadline (deterministic clock, no runtime change).** A synthetic monotonic clock (`setDeadlineClockForTests`) and a fake pool drive the production limiter with its **default 1,250 ms** deadline:

| Phase where time runs out | Elapsed at acknowledgement | Result |
|---|---|---|
| COMMIT | 1,249 ms | **admitted** |
| COMMIT | 1,250 ms | refused, `commit_late` |
| COMMIT | 1,300 ms | refused, `commit_late` |
| decision statement | 1,300 ms | refused, `deadline`; no COMMIT sent |
| ROLLBACK path | 1,300 ms | refused, `deadline`; no COMMIT sent |

**Sensitivity (+2 ms sustained).** The review's +2 ms sustained limiter slowdown passed at 3.83× because the old denominator was max(before, after) and one 405 ms control inflated it. The correction is the **median of all six controls**: a single outlier control cannot move it, and nothing is tuned to a CI measurement (R_MAX = 5 and ENV = 5 s are unchanged). The review's exact inputs now fail (fixture above).
- A **live** +2 ms scenario (4b) was added. Locally it measures **13.0–22.2×** (6 runs) and fails C.
- Its live assertion is **environment-independent**: the sustained slowdown's best ratio must rank above both healthy bests from the same run, with exact accounting. Whether it also crosses R_MAX is logged as informational, because that depends on the runner (see Remaining limitations). Asserting a live R_MAX crossing would repeat the environment-dependent mistake fixed in round 2.

**B unchanged:** 480 admissions, 16 full shards, exact accounting, 1,520 quota refusals.

**S12 offline: same flake class as S10, fixed in this round.** The full serial regression failed `mcpOAuthS12` offline once: `P3-corr no false refusal: untagged retained hex 16 B (10,000 CSPRNG samples) -- 1`. This is the S10 class: a fresh CSPRNG 16-byte value with no a–f letter (≈2.9e-7 per sample, ≈0.29% per 10,000) is refused **by policy**. The six "no false refusal" rows now use a **fixed seed** with policy-aware verdicts (digits-only untagged hex must be refused). Added a reproduction (the recorded digits-only value is refused untagged, so the old assertion fails on it) and its `hex:`-declared acceptance. S12 offline: **86/86** (was 84; +2 fixtures), 3/3 repeats. The refused value was not logged by the old test; its class is inferred from the S10 4,000,000-sample probe, where the only refusal of untagged random hex was digits-only.

### Separation of assertions

| Concern | Where | Timing-dependent? |
|---|---|---|
| Fail-closed, cause classification, ambiguous-COMMIT accounting, admitted ≤ counted ≤ G, shard-specific 429 validation | A (and B) | No |
| Production-deadline enforcement (1,249 admits; 1,250 / 1,300 refused) | deterministic clock test | No |
| Response completion bounded | A | Only through a fixed 500 ms allowance, not a throughput ratio |
| Availability (exactly G, all shards full) | B | No (extended budget) |
| Limiter performance regression | C | Yes: limiterMs / median of six controls, best of 3, every trial exact |
| Environment usability | ENV | Yes: an absolute bound |

### Residual: reproduction and correction
The deterministic scenario **"fast controls, then a healthy limiter flood under temporary contention"** applies +2 ms per statement only to the production flood, and +3 ms to one of the three C trials; the controls stay fast.
- **Reproduced, deterministically:** a replay of the v1 formula on fixed inputs (CI-recorded fast controls of 252 ms, giving a floor of 1,984, and a healthy flood that shed to 1,500 completed) **fails**. This is asserted.
- **Live comparison, informational only:** v1 would also have failed every local run (floor 2,000, 1,474–1,650 completed). On CI run 45594423214 the controls were slow (511 ms, floor 978), so v1 would have passed that run.
  - That is why the earlier live "v1 would fail" assertion was environment-dependent, and it **failed CI**. It was replaced by the replay. All real checks passed in that run.
- **Corrected:** A passes, since the shedding is classified as `deadline`, the deadline is enforced and accounting is exact. B passes. C passes: the contended trial's ratio is 23–29, the other two 1.95–2.75.
- **Distinguished from genuine degradation:** limiter-only +10 ms per statement in every limiter flood **fails C** (all trials 44–80). A stays safe for both scenarios, with exact accounting.

### Results
**CI run 45594423214** (head `5aa35472`, before the two corrections above): 53/54, with only the environment-dependent replay assertion failing.

| Scenario | A | C best (trial ratios) | Verdict |
|---|---|---|---|
| Healthy (controls 536–746 ms) | pass; flood 972–1,109 ms, 480 / 480 | 1.78 / 1.80 | pass |
| Shared +2 ms | pass | 1.06 | pass |
| Residual | pass | 1.79 (contended trial 3.61) | pass |
| Degradation +10 ms | safe (227 / 227) | **11.24** (11.51 / 11.24 / 11.30) | **fail** (detected) |

**Local** (`max_connections = 100`; earlier rows from 3 runs with R_MAX = 8, then 2 runs with the final R_MAX = 5, 54/54 each):

| Scenario | A | C trial ratios (control ms, limiter ms) | C best | Verdict |
|---|---|---|---|---|
| Healthy #1 / #2 (10 samples) | pass; flood 163–336 ms, 480 / 480 | 1.85–3.34 (68–158 ms, 179–341 ms) | 1.85–2.67 | pass |
| Shared slowdown +2 ms | pass; flood about 1,266 ms (shedding), 480 / 480 | 1.19–1.29 (1,273–1,353, 1,534–1,738) | 1.19 | pass |
| Residual (fast controls, contended healthy flood) | pass; deadline sheds classified, 480 / 480 | contended trial 23.6–28.3; others 1.95–2.75 | 1.95–2.28 | pass |
| **Limiter-only degradation** (+10 ms) | pass (safe, exact) | 44.8–84.5 (81–145, 6,419–6,655) | **44.8–65.9** | **fail** (detected) |
| Unusably slow environment (control +12 ms) | — | control above 5,000 ms | — | **fail** |

**CI run 45606688808** (head `882a04f0`, round 3): **7/7**; StagingBlockersDb 68/68; offline S8 60, S10 135, S11 31, S12 86.

| Scenario | A | C best (control median ms) | Verdict |
|---|---|---|---|
| Healthy #1 / #2 | pass | 3.20 / 3.12 (248.5 / 253.5) | pass |
| Shared +2 ms | pass | 1.14 (1,444.5) | pass |
| Residual | pass | 3.80 (211) | pass |
| Degradation +10 ms | safe, exact | **25.31** | **fail** (detected) |
| Sustained +2 ms (4b) | safe, exact | **7.15** (230.5) | **fail** (detected; ranks above healthy) |

**Local, round 3** (corrected checker; 6 StagingBlockersDb runs, 68/68 each; ratios use the six-control median):

| Scenario | A | C best (control median ms) | Verdict |
|---|---|---|---|
| Healthy #1 / #2 | pass | 2.40–2.57 (69–80); worst single trial 5.68, absorbed by best of 3 | pass |
| Shared +2 ms | pass | 1.08–1.19 (1,257–1,323) | pass |
| Residual | pass | 2.33–2.72; contended trial 22.3–32.5 | pass |
| Degradation +10 ms | safe, exact | 69.4–83.0 | **fail** (detected) |
| Sustained +2 ms (4b) | safe, exact | 13.0–22.2 | **fail** (detected locally); ranks above healthy |

**Negative controls**, all failing A as required:
- injected pre-COMMIT driver faults (`driver`);
- post-send connection loss (`commit_lost`; counted ≤ G);
- explicit COMMIT refusal (`commit_failed`; nothing counted);
- "0 admitted, 2,000 unavailable";
- all shed by the deadline (liveness);
- a limiter answering 429 to everything (refusals on shards that are not exactly full);
- decisions answered long after the deadline (response completion not bounded).

B's exactness and per-shard accounting pass.

### Remaining limitations
- **C is a timing comparison.** On CI the separation is about 2× on each side of R_MAX = 5 (healthy best 1.80, degradation +10 ms 11.2); locally it is much wider. Best-of-3 absorbs one transient. With the median denominator, failing a healthy limiter needs a contention burst covering all three limiter trials while sparing at least four of the six controls.
- **Healthy margin narrowed on CI (a cost of the median denominator).** The median of six controls is smaller than the old max(before, after), so every ratio rises. Healthy CI bests went from about 1.8 (previous head) to **3.12–3.20** (run 45606688808), leaving about **1.56×** headroom below R_MAX = 5; locally healthy bests are 2.40–2.57. Best of 3 still absorbs one transient (the worst single healthy trial seen locally was 5.68). R_MAX was **not** raised: raising it would weaken detection and would be tuning to one CI run. If healthy CI ratios approach 5 in future runs, the right fix is a better-matched control (not a larger R_MAX), and that needs a separate decision.
- **Remaining sensitivity: the smallest detectable sustained slowdown depends on the runner.** C detects a sustained slowdown once it adds roughly (R_MAX − healthy ratio) × control-flood time. Locally (controls about 70 ms) +2 ms/statement is detected at 13–22×; on CI run 45606688808 (controls about 230 ms) at **7.15×**. A pre-CI estimate in this report, extrapolated from older 530 ms controls, predicted about 4× on CI; that estimate was **wrong for this run**. On a runner with markedly slower controls +2 ms could still fall below R_MAX, so the live 4b check asserts ranking above healthy, not an R_MAX crossing (the crossing is logged as informational). Closing this fully would need a non-timing performance signal (e.g. statement counts), which is out of scope for a test-only change.
- **The response-completion bound uses a 500 ms allowance** for event-loop lag with 2,000 pending promises (observed maximum latencies 1,252–1,268 ms). It no longer has any role in admission timing.
- **S11 offline has the same random-sample pattern** (`mcpOAuthS11.test.ts`, two 10,000-sample untagged hex rows, about 0.58% per run combined). It is outside this ticket's S8/S10/S12 scope and was **not changed**; recorded for a follow-up.
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
  - offline: transport, Local 119, SecurityRegression 34, I2b 116, StagingBlockers 52, S8 60, S10 135, S11 31, S12 **86**;
  - DB: Postgres 36, StorageProtection 42, StagingBlockersDb **68**, StoreS4 13, CodeS6 14, S8Db 11, S10Db 21, S11Db 19, S12Db 15;
  - dbIdentityGuard.
- **Repeats:** round 3 StagingBlockersDb 6/6 (68/68 each); S12 offline 3/3 after the fixed-seed correction; earlier rounds StagingBlockersDb 5/5, S10 and S8 offline 3/3.
- **Serial, isolated:** every suite ran one at a time against a disposable local PG16 (socket only, `max_connections = 100`); no live database, no credentials.
- **No retries** were used to hide failures.
- **Exact-head CI:** run 45606688808 on `882a04f0`, 7/7 (code head; this report-only update follows it). Also recorded in the PR description.
