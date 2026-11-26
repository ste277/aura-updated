# AURA-MCP-CI-01: stabilize the S8, S10, S11 and S12 regression tests

- **Base:** main `1605355f2bd289cb8f42e50ecd28f7522f3977da` (PR #390). **PR:** #394, branch `test/aura-mcp-ci-01-stabilize-s8-s12`.
- **Scope:** **test-only.** Changed: `test/mcpOAuthStagingBlockersDb.test.ts`, `test/mcpOAuthS8.test.ts`, `test/mcpOAuthS10.test.ts`, `test/mcpOAuthS11.test.ts` and `test/mcpOAuthS12.test.ts`.
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
- **quota refusal at decision time** (round 5, §1b): every 429 must have seen a key at its limit in the limiter's own locked read when it decided, and every admission must have seen capacity. Evidence is the `DECIDE` result, recorded in the test harness;
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
- **Verdict** (round 5, §1b): `invalid` if any trial is incorrect or any control fails ENV; otherwise `pass` (best ≤ R_MAX) or `exceeds` (best > R_MAX). Only a **valid** `exceeds` establishes degradation detection.
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

### 1b. Round 5: the two remaining S12 assertion gaps (independent review of `54e323d6`)
The reviewer's probe (`independent-assertions.log`) showed two gaps; S12-B was closed by that review and is unchanged. Each gap is reproduced against the **reviewed head's own logic**, kept in the test file as frozen references:
- `checkABase` is byte-identical to the reviewed `checkA`; `accounting` and `exactness` are unchanged. This was verified with a script against `git show 54e323d6`.
- `prevDegradationDetected` / `prevSustainedRanked` are the two live expressions at `54e323d6`.

**S12-A: quota-refusal timing.**
- **Defect:** the shard check used only the **final** count. A 429 decided when the shard held 0 passed if the shard later filled to 30. The reviewer reproduced it: `early refusal on an eventually full shard`, with `checkA ok: true`.
- **Evidence used:** the limiter's `DECIDE` statement locks the rows (`FOR UPDATE`, sorted keys) and returns each key's count as read under that lock, with the verdict. A **test-only** pool wrapper (`observed`) records each request's last complete `DECIDE` result, keyed by an `AsyncLocalStorage` request index. This is the capacity each transaction actually saw, in the database's lock order. It does **not** use response-completion order. No runtime change was needed.
- **New rule** (`decisionTime`, added to A only):
  - every decided request has complete evidence that includes **its own** shard key;
  - no decision-time count exceeds the shard's final count;
  - an admission saw `ok` and every key below its limit;
  - a 429 saw `ok = false` with a key **at** its limit.
- **Ambiguous COMMITs:** an ambiguous COMMIT is never assumed to have landed. A later 429 is valid only if its own locked read saw the key full. The final over-count bound (≤ ambiguous COMMITs per shard) is unchanged.

| Deterministic fixture (shard 0) | Reviewed A | Corrected A |
|---|---|---|
| 429 at decision-time count 0, then the shard fills to 30 (review's case) | accepts | **rejects** |
| 429 at count 29 on a shard that ends full | accepts | **rejects** |
| 429 decided at 29 **before** an ambiguous `commit_timeout` landed (final 30) | accepts | **rejects** |
| 429 with no decision-time evidence | accepts | **rejects** |
| 429 whose evidence is for another shard | accepts | **rejects** |
| 429 on a shard that never fills (final 29) | rejects | rejects |
| Unexplained over-count (30 counted, 29 admitted, no ambiguous COMMIT) | rejects | rejects |
| Legitimate 429s at count 30 | accepts | **accepts** |
| **Concurrent ordering:** the 429 response completes first (1 ms) and is first in request order; admissions complete later (200–229 ms) | accepts | **accepts** |
| Ambiguous COMMIT that landed (saw 29), then 429s at 30 | accepts | **accepts** |
| Ambiguous COMMIT, no 429s: over-count 1 explained | accepts | **accepts** |

The existing legitimate-ambiguity fixture from round 3 now carries decision-time evidence and still passes.

**Live evidence** (each healthy flood, every run): evidence for **2,000 of 2,000** decided requests. All **1,520** live 429s saw their shard at exactly 30, and all **480** admissions saw it below 30. The fault-injection floods are recorded the same way and still fail A for their own causes.

**S12-C: invalid degradation measurements.**
- **Defect:** both live degradation assertions read C's failure as detection, `!C.ok && best > R_MAX` and `best > max(healthy)`. A C run that failed because the measurement was **invalid** also satisfied them. The reviewer reproduced it with an all-429 measured trial, and with a 5,001 ms after-control, each at ratio 8.
- **Fix:** C first decides **validity** (every trial exact, every control within ENV), then evaluates the threshold. It returns `verdict ∈ {pass, exceeds, invalid}`.
- **Live assertions now:**
  - `degradationDetected` requires a **valid** `exceeds`;
  - `sustainedRanked` requires a **valid** measurement ranked above both healthy bests;
  - the residual-vs-degradation distinction uses `degradationDetected`.
- **Unchanged:** the median of six controls, R_MAX = 5, ENV = 5 s, healthy, shared, residual and degradation scenarios; no new timing requirement.

| Deterministic C fixture | Verdict | Reviewed head's two assertions | Corrected assertions |
|---|---|---|---|
| All-429 measured trial (ratio 8) | invalid | both **accept** | both **reject** |
| 5,001 ms after-control (ratio 8, median 100) | invalid | both **accept** | both **reject** |
| Valid, ratio 8 | exceeds | accept | **accept** |
| Valid, ratio 2.5 | pass (C ok) | — | degradation **not** detected |

**Sampling estimate corrected.** The remaining S12 tagged-format random draws (6 × 10,000) fail by policy with about **0.0143% per run** (independent assessment), not "≤ about 2e-4" as round 4 stated. They are unchanged.

### Separation of assertions

| Concern | Where | Timing-dependent? |
|---|---|---|
| Fail-closed, cause classification, ambiguous-COMMIT accounting, admitted ≤ counted ≤ G, shard-specific 429 validation | A (and B) | No |
| Production-deadline enforcement (1,249 admits; 1,250 / 1,300 refused) | deterministic clock test | No |
| Quota refusal valid at decision time (locked-read evidence) | A | No |
| Measurement validity before the threshold (pass / exceeds / invalid) | C | Validity: no; threshold: yes |
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
- **C is a timing comparison.** With the median denominator (CI run 45606688808): healthy best 3.12–3.20, sustained +2 ms 7.15, +10 ms 25.31, against R_MAX = 5. The earlier max(before, after) denominator gave healthy 1.80 and +10 ms 11.2 on a slower-control run. Locally the separation is much wider. Best-of-3 absorbs one transient. With the median denominator, failing a healthy limiter needs a contention burst covering all three limiter trials while sparing at least four of the six controls.
- **Healthy margin narrowed on CI (a cost of the median denominator).** The median of six controls is smaller than the old max(before, after), so every ratio rises. Healthy CI bests went from about 1.8 (previous head) to **3.12–3.20** (run 45606688808), leaving about **1.56×** headroom below R_MAX = 5; locally healthy bests are 2.40–2.57. Best of 3 still absorbs one transient (the worst single healthy trial seen locally was 5.68). R_MAX was **not** raised: raising it would weaken detection and would be tuning to one CI run. If healthy CI ratios approach 5 in future runs, the right fix is a better-matched control (not a larger R_MAX), and that needs a separate decision.
- **Remaining sensitivity: the smallest detectable sustained slowdown depends on the runner.** C detects a sustained slowdown once it adds roughly (R_MAX − healthy ratio) × control-flood time. Locally (controls about 70 ms) +2 ms/statement is detected at 13–22×; on CI run 45606688808 (controls about 230 ms) at **7.15×**. A pre-CI estimate in this report, extrapolated from older 530 ms controls, predicted about 4× on CI; that estimate was **wrong for this run**. On a runner with markedly slower controls +2 ms could still fall below R_MAX, so the live 4b check asserts ranking above healthy, not an R_MAX crossing (the crossing is logged as informational). Closing this fully would need a non-timing performance signal (e.g. statement counts), which is out of scope for a test-only change.
- **The response-completion bound uses a 500 ms allowance** for event-loop lag with 2,000 pending promises (observed maximum latencies 1,252–1,268 ms). It no longer has any role in admission timing.
- **Secret-policy sampling:** after round 4 (§4) no MCP test asserts a policy verdict on a fresh random secret where the policy refuses a legitimate draw with non-negligible probability. The remaining fresh random-sample loops (tagged `hex:` / `base64:` / `base64url:` acceptance in `mcpOAuthS12`, 6 × 10,000) fail by policy with about **0.0143% per run** across the 60,000 draws (independent assessment; corrected from round 4's "≤ about 2e-4"). That is within the policy's documented false-refusal budget, not a confirmed instance of this defect, so they were left unchanged (no general hardening).
- **Decision-time evidence depends on the `DECIDE` statement shape.** The harness recognises it by its `WITH want` prefix and its key / limit parameters. If the runtime statement changes, the evidence is missing, and A **fails** (it does not pass vacuously).
- **`assessSecret` compatibility comment** ("nothing S8 accepted is newly refused") remains a documented discrepancy: the vetoes run first by design. No runtime change is authorised.
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
- **Result:** S10 offline 135/135 in every run (137/137 after the round 4 additions in §4).

## 4. Round 4: deterministic secret sampling (S11 and the narrow sweep)
**Defect class.** A test draws **fresh random** secrets and asserts a policy verdict (for example "all accepted") that the documented policy does not guarantee for every possible draw. The runtime policy is unchanged; only the assertions were wrong.

**Fix, everywhere:** a **fixed-seed corpus** (SHA-256 of a per-suite label, tag, index and block), with every verdict checked against an **independently derived** policy expectation. Each confirmed instance gets a reproduction fixture on which the old assertion fails.

| Suite / check | Defect | Measured | Correction |
|---|---|---|---|
| **S11** `P3-2 hex 16 B` / `HEX 16 B` (10,000 each) | digits-only untagged hex → legacy text → refused by policy | 2.9e-7 per sample; ≈0.58% per run | fixed seed; expected verdict **and** canonical format from the policy (hex credit needs an a–f letter; otherwise the S8 legacy rule, derived independently) |
| S11 `P3-2 base64 / base64url` rows (4 × 10,000) | same pattern | negligible (≤ 3e-9) | seeded for consistency, same check |
| S11 single samples (`b24`, `odd`, `canon44`, `url43`, `withRun`, 16-byte hex = 128 bits) | one fresh draw each; the 16-byte hex one is the digits-only class | ≈2.9e-7 per run | all seeded; the hex value is asserted to contain a letter |
| **S10** compatibility loop (30,000 mixed-alphabet strings: "none the S8 rule accepted is newly refused") | an S8-accepted, canonical base64url value from the `abcdef0123456789-_.` alphabet uses too few symbols for its character groups and is refused by the S12 **low-variety veto**, which deliberately covers untagged retained keys | **3 refusals in 3,000,000** samples (≈2.87 M S8-accepted) → ≈**3% of runs** | fixed seed; every refusal must be `low_variety` + format `base64` **and** satisfy an independently computed low-variety predicate (group alphabet, < ½ expected distinct symbols) |
| S10 single samples (16-byte floor check; the untagged hex retained-key loader check) | digits-only class | ≈2.9e-7 per run each | seeded; letter asserted |
| S12 offline "no false refusal" | digits-only class (failed once in round 3) | ≈0.29% per run | fixed in round 3 (§1a) |

**Reproduction fixtures** (deterministic):
- **S11:** the recorded digits-only value `64976964540383724985906370631171` is legacy text and refused, in either case. The old "10,000 samples all canonical and accepted" assertion fails on it.
- **S10:** the probe-recorded value `8b55_5f4747b1_a0-10-_156-0e-8e01-6f7e_4_-1-e` is accepted by the S8 rule but refused `low_variety`. The old "none is newly refused" assertion fails on it.

**Probe:** a scratch script outside the repo, not committed.
- 3,000,000 draws of the S10 compatibility population produced 3 `low_variety` refusals, all from alphabet 3.
- 4,000,000 fresh 16-byte hex draws produced 1 refusal, as expected at 2.9e-7.

**Policy observation, not changed:** the comment in `assessSecret` ("nothing S8 accepted is newly refused") is broader than the code. The run, skewed and low-variety vetoes run first, by design since S12 (the S11 suite already asserts the run veto overrides the S8 rule). This is a documentation inaccuracy in runtime code, not a behavioural defect, and it is out of scope for a test-only change.

**Narrow sweep, not corrected:**
- **Other random values in the MCP suites:** PKCE verifiers, HMAC and bucket keys, forged-token keys, ephemeral keys and IPv6 fuzz inputs. None of them goes through the secret policy.
- **Tagged-format acceptance loops in S12:** left unchanged. They fail at about 0.0143% per run, per the independent assessment; see Remaining limitations.
- **S8:** CLOSED, and it uses tagged values only.

**Results:**
- offline S10 **137/137** (+2) and S11 **33/33** (+2), each 3/3 repeats;
- S12 offline 86/86;
- the full serial regression below.

## 5. Verification
- **All MCP suites** (`max_connections = 100`) passed:
  - offline: transport, Local 119, SecurityRegression 34, I2b 116, StagingBlockers 52, S8 60, S10 **137**, S11 **33**, S12 **86**;
  - DB: Postgres 36, StorageProtection 42, StagingBlockersDb **87**, StoreS4 13, CodeS6 14, S8Db 11, S10Db 21, S11Db 19, S12Db 15;
  - dbIdentityGuard.
- **Repeats:** round 5 full serial regression 19/19 suites, plus StagingBlockersDb 5/5 runs (87/87 each); healthy C bests 2.39–2.69, +2 ms 19.6–21.1, +10 ms 71–87, all valid; round 4 full serial regression 19/19 suites, plus S10 and S11 3/3 each; round 3 StagingBlockersDb 6/6 (68/68 each); S12 offline 3/3 after the fixed-seed correction; earlier rounds StagingBlockersDb 5/5, S10 and S8 offline 3/3.
- **Serial, isolated:** every suite ran one at a time against a disposable local PG16 (socket only, `max_connections = 100`); no live database, no credentials.
- **No retries** were used to hide failures.
- **Exact-head CI:** round 3 `882a04f0` run 45606688808, 7/7; round 4 `54e323d6` run 45610989652, 7/7. The round 5 final-head run is recorded in the PR description.

## 6. Merge and closure (ticket 39408, 2026-11-26)

**Status: COMPLETE.** Main CI is green, MCP stays disabled, and staging acceptance is deferred. This section was added afterwards in the MCP-CI-02 PR (ticket 39410), at the owner's direction (no docs-only PR). Sections 1–5 describe the state before the merge and are unchanged.

| Item | Value |
|---|---|
| PR | #394, squash merge with head-commit guard, approved by the owner on 2026-11-26 |
| Approved head | `c3a443f38a358fcf7caba179f2df07f935aa3037` (independent GO; S8, S10, S11 and S12-A/B/C CLOSED) |
| Pre-merge main (squash parent) | `3b568302877b3672e46aa0449d530007c5c56326` (#395, AURA-CI-07 fix) |
| Verified integration CI | run 45784055130, attempt 1, **7/7**, merge ref `8f53b2c` (c3a443f into 3b56830) |
| Squash commit | **`3feff0342c48959be7006648ee4bdcaa71fbb162`**, merged 2026-11-26T09:41:58Z |
| Post-merge main CI | run **45794392858** (push, `3feff03`), attempt 1, **7/7**, with no FAIL lines |

**The merge matches the reviewed candidate:**
- The squash tree `78d0a747…` is the tree that run 45784055130 tested.
- `git diff 3b56830 3feff03` is byte-identical to `git diff 3b56830...c3a443f`.
- It changes six files: five tests plus this report. No runtime code, dependencies, migrations, deployment configuration or activation settings changed.

**Integration history:**
- Run 45629975131 (against `7b80f98`): 6/7. Day Constructor hit AURA-CI-07 occurrence 6; it was archived and not rerun.
- Run 45782372636: **invalid** as acceptance evidence, because it checked out a stale merge ref (`7b29dde`).
- Run 45784055130: valid, 7/7.

**Post-merge results:**
- S8 offline 60 and DB 11; S10 offline 137 and DB 21; S11 offline 33 and DB 19; S12 offline 86 and DB 15.
- Staging-blocker DB 87 (limiter gate); S2 offline 52.
- I2b offline 116, Postgres 36, R1 storage 42, S4 13, S6 14; I2a 119, I2a-R1 34.
- Day Constructor passed, and CI-07 did not recur.

**Production isolation:**
- Git Production deployment `dpl_4KnftpEnjiPGP42Ka6NMiw8WWBRh` was canceled by the Ignored Build Step. There was no install, build or migration.
- The live alias is still `dpl_3SstUr7PBWFJHG6zM2oKjPxVBUhE` (REL-04). Nothing was promoted or activated.

**Accepted limitations (carried forward):**
- Detecting small sustained slowdowns depends on the runner (healthy CI ratio about 3.1–3.3 against R_MAX 5, median of six controls).
- Leftover random-sampling failures at about 0.0143% per run.
- If the decision-statement instrumentation stops supplying usable evidence, the check fails explicitly.
- The `assessSecret` compatibility comment discrepancy is still open.
- The 3feff03 commit has no Co-Authored-By line. This is accepted, and main will not be rewritten.

**Evidence:**
- The independent bundle passed 79/79 checksum checks. The author-side bundle was not independently checksum-verified.
- Merge and closure evidence: `AuraEvidence/AURA_MCP_CI_01_MERGE_CLOSURE_20261126/` (29 files, `SHA256SUMS` sha256 `5db02470…0f75`).
- The untracked closure record is `AURA_MCP_CI_01_MERGE_CLOSURE.md` at the repo root.

**Still open:**
- MCP-CI-02 (ticket 39410) is open. Its correction is in the PR that carries this section.
- PR #393 is a separate decision.
- MCP development is paused: no S13, with D2–D10 and V1–V6 carried forward. Staging is NO-GO and Production is on HOLD for MCP.
