# AURA-MCP-CI-01: stabilize the S8 and S12 regression tests

- **Base:** main `1605355f2bd289cb8f42e50ecd28f7522f3977da` (PR #390). **Branch:** `test/aura-mcp-ci-01-stabilize-s8-s12`.
- **Scope:** **test-only.** Two files changed: `test/mcpOAuthStagingBlockersDb.test.ts` and `test/mcpOAuthS8.test.ts`.
  - No change to the limiter, HMAC, authentication, deadlines, migrations, dependencies, branch protection or deployment configuration.
  - MCP stays disabled.
- **Evidence:** the post-merge evidence bundle (`AURA_MCP_02_I2B_S12_FINAL_INDEPENDENT_REVIEW/post-merge-ci/`) is unchanged.

## 1. S12 aggregate limiter availability gate

**Root cause.** The S12 gate judged the production-deadline flood (2,000 decisions, 1,250 ms deadline, 3 instances × 5 connections) against an **admission** floor of min(G, capacity / 2). Capacity came from a **sequential, single-connection** control.
- A fast sequential control (0.43 ms) saturated the floor at **exactly G = 480**, while the runner was slow under the concurrent flood (1,296 ms).
- Under any deadline shedding, lock queues on the 16 hot shard rows can leave a shard short of its 30, so a healthy limiter admitted 476. The run had 0 unexpected failures and 476 ≤ 477 ≤ 480.

**Correction.** Nothing is derived from the limiter run being judged. The deadline is unchanged.
1. **Concurrent baseline.** A control flood with the flood's own shape: 3 pools × 5 connections (application bounds), 2,000 concurrent units of 4 round trips (BEGIN + SET LOCAL; an advisory lock on one of 16 hot keys; an advisory lock on one of 500 network keys; COMMIT). It uses no limiter code and no table, and runs **immediately before and after** the limiter flood. The **slower** of the two is used, so a slowdown that starts during the flood is captured.
2. **Capacity** = 2,000 × 1,250 / (K × controlMs), with **K = 2.5** fixed. Measured limiter/control duration ratios: 1.8–2.43 on an idle runner, 1.2–1.4 under +1 / +2 ms per-statement contention. K bounds every regime, so capacity is a lower-bound estimate. (K = 4 was tried first; it under-estimated capacity in the contended regime CI resembles and tripped the meaningfulness guard at +2 ms.)
3. **Availability on completed decisions** (admitted + 429, i.e. not shed): completed ≥ **floor = min(2000, ⌊capacity / 2⌋)**. The ½ margin absorbs run-to-run variance. The floor no longer saturates at G, so ordinary shedding cannot fail a healthy limiter.
4. **Meaningfulness.** If the floor is below G / 2 (240), the environment is too slow to certify availability and the gate **fails** rather than passing vacuously.
5. **Exact, timing-free accounting.** Shard assignment is deterministic (decision i → shard i mod 16). For every shard, admitted = min(30, completed), and a 429 is legitimate only on a **full** shard.
6. **Safety (unchanged):** 0 unexpected causes; admitted ≤ counted ≤ G; any over-count only from ambiguous or late COMMITs. The extended-budget exactness test is unchanged (exactly 480, all 16 shards at 30, only 429s).

**Reproduction of the original failure.** Replaying the recorded attempt-1 values through the S12 formula (baseline 0.43 ms gives capacity 10,901, so the floor is min(480, 5,450) = 480; admitted 476) **fails**. This is asserted in the suite. The live mid-flood slowdown run admitted 480 locally, so the S12 verdict there is informational only.

**Results.** 5 full suite runs, 52/52 each, at `max_connections = 100`, with deterministic latency injection.

| Scenario | Slower control | Floor | Flood | Completed | Admitted / counted | Gate |
|---|---|---|---|---|---|---|
| Healthy (3 per run, 15 total) | 75–205 ms | 2,000 | 183–273 ms | 2,000 | 480 / 480 | pass |
| Shared contention +1 ms/statement | 703–815 ms | 613–711 | 886–976 ms | 2,000 | 480 / 480 | pass |
| Shared contention +2 ms/statement | 1,287–1,436 ms | 348–388 | 1,267–1,271 ms | 1,414–1,579 | 480 / 480 | pass |
| Spike during flood (limiter and after-control +2 ms; before-control fast) | 1,311–1,366 ms | 366–381 | 1,267–1,273 ms | 1,390–1,601 | 480 / 480 | pass |
| **Limiter-only degradation** (+10 ms in the limiter only) | 81–264 ms | 1,893–2,000 | 1,261–1,270 ms | 210–225 | 210–225 | **FAIL** |

**Negative controls**, all failing the corrected gate as required:
- an environment too slow to certify (control 4,000 ms, floor 125);
- injected pre-COMMIT driver faults (`driver`);
- post-send connection loss (`commit_lost`; counted ≤ G);
- explicit COMMIT refusal (`commit_failed`; nothing counted);
- "0 admitted, 2,000 unavailable";
- pure deadline shedding;
- **a limiter that answers 429 to everything** (2,000 "completed", rejected by the per-shard accounting).

**Remaining timing sensitivity.**
- When both controls are fast, the floor can reach 2,000 (no shedding allowed). A slowdown confined to the flood that ends before the after-control can still fail the gate.
- The bracketing makes that window narrow: a healthy flood finishes far inside the deadline on a fast runner (183–273 ms locally), and on CI the slower runner gives floors below 2,000 (attempt 2: flood 777 ms).
- The CI diagnostics print every input (controls, capacity, floor, completed, outcomes), so any future failure is classifiable from the log alone.

## 2. S8 address-bucket HMAC assertion

**Root cause.** The check excluded the substrings `2001` and `db8` from a 32-hex-character HMAC computed under a **random** key, so a legitimate hash fails by chance on about 0.7% of runs. CI recorded `preauth-mcp:addr:h:8279a8d5a62002391ea7cdb81db70872`.

**Correction.** The check now uses exact cryptographic verification. The production HMAC is unchanged.
- **Reproduction:** the old predicate rejects the recorded CI hash, and also a fixed synthetic secret found by a deterministic search.
- **Exact equality:** the bucket key for that fixed synthetic secret equals an HMAC computed independently with Node crypto: key = HMAC-SHA-256(secret, `aura-mcp-preauth-bucket-key-v1`); value = `h:` + first 32 hex of HMAC-SHA-256(key, `aura-mcp-preauth-bucket-v1\0v6:2001:db8:1:2::/64`).
- **Preserved:** the output format (`preauth-mcp:addr:h:` + 32 lower-case hex), shared-key agreement and /64 grouping, different networks giving different keys, key separation, the readable `unresolved` bucket, and refusal of short keys.
- **Negative controls:** an HMAC under a different key does not match; a cleartext bucket is neither the expected key nor valid in format.
- **Result:** S8 offline 60/60, 5 runs out of 5.

## 3. Verification
- **All MCP suites** (at `max_connections = 100`):
  - offline: transport, Local 119, SecurityRegression 34, I2b 116, StagingBlockers 52, S8 60, S11 31, S12 84;
  - DB: Postgres 36, StorageProtection 42, **StagingBlockersDb 52**, StoreS4 13, CodeS6 14, S8Db 11, S10Db 21, S11Db 19, S12Db 15;
  - dbIdentityGuard.
  - All passed, except one S10 offline run (see §4).
- **No retries** were used to hide failures.

## 4. Separate finding (not in scope, not changed): S10 offline intermittent assertion
- **Observed:** during the regression run, `mcpOAuthS10` reported "16-byte hex: 20,000 CSPRNG samples, 0 refused" with **1 refused**.
- **Root cause (investigated):** a genuine random 16-byte hex value containing **no a–f letter** (sample `64976964540383724985906370631171`, probability (10/16)^32 ≈ 2.9e-7) is not treated as hex on the untagged legacy path, by design: an all-digit value looks decimal. It falls back to the S8 rule, which also refused it before (at most about 106 bits). **This is not a runtime defect:**
  - nothing S8 accepted is newly refused;
  - tagged `hex:` secrets accept all-digit values;
  - a 4,000,000-sample probe found exactly 1 such refusal, matching the probability.
- **Effect:** the S10 assertion has an inherent ~0.6% failure rate per run.
- **Proposed separate test-only correction:** exclude all-digit samples from that assertion, or assert the documented refusal for them.

## 5. PR
The exact head and CI results are recorded in the PR description. Auto-fix and Auto-merge are off, and nothing merges without approval. The PR is ready for focused Codex review.
