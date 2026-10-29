# R2E-03: L7 Watchdog and Runner Regression Evidence

## 1. What failed (run r2e_full1)
**A. L7 checks failed.** There were three causes:
1. **The setuid `/bin/ps` cannot run inside `sandbox-exec`.** In the earlier run this made the observer report "watchdog not alive". Fixed by the mock `ps` rewrite.
2. **Test design.** The test used N=3, which is shorter than the t+5 residual window. It also checked the observer log after a fixed `sleep 1`, which is racy.
3. **Runner bug.** `recover()` called the mock without `R2D_MOCK_DIR`, so the mock exited at its guard and nothing was recovered.

**B. Runner hang (≈3 h) at T4_L7_watchdog_dead.** Two causes:
1. The runner sent `kill` (TERM) to a watchdog that ignores TERM **by design**. The watchdog stayed alive, so the observer correctly saw it alive.
2. The observer then waited **without a bound** for a harness kill that the runner only performed after the observer exited. That was a deadlock.

**Process cleanup performed (exact test-owned PIDs only):**
- harness 73930 (KILL)
- observer 74514 (KILL)
- their `sleep` children 13169 and 13170
- runner 27046 and its parent shell 27045
- an orphaned harness 13329 (KILL), spawned by the next scenario when the runner was terminated, and its `sleep` child 13953

No unrelated process was touched. Afterwards no harness, watchdog or runner process remained.

**C. Real harness defect found.** The same TERM-ignoring property meant the harness's **own teardown never cancelled the watchdog**. That was harmless (the watchdog only locks the throwaway path) but wrong.

## 2. Corrections
| Item | Correction |
|---|---|
| Watchdog identity (`is_wd`) | Exact PID, plus argv ending ` r2d_watchdog <N> <exact keychain> <exact security path>`, plus parent = harness PID. PID-based, not name-based. |
| Teardown cancel | KILL after an `is_wd` match, then `wait`. If the watchdog is still present afterwards, cleanup becomes UNVERIFIED. |
| Observer | The harness must be alive and identifiable at start. The watchdog must pass `is_wd`. The wait for the kill is bounded (900 s REAL). PASS additionally needs an unlocked residual at t+5 when N>5, the watchdog gone by the deadline, and a matching mode (8th field). |
| `ps -ww` | Unlimited width for every harness `ps` call. |
| Mock `ps` | Uses `pgrep` (not setuid): exact-PID first argv line, and a true-parent lookup among logged harness PIDs. |

## 3. Watchdog regression results (final run, all PASS)
| Requirement (ticket Task B) | Scenario / check |
|---|---|
| Works inside the approved sandbox | All T4 scenarios run under the unchanged deny profile. The sandbox was not weakened; it was tightened. |
| Identifies the intended watchdog | T4_L7_pass: exact argv tail and parent=harness; the observer logs `argv=exact parent=<harness>` |
| Does not mistake an unrelated process | T4_L7_decoy: a decoy with an **identical argv** but a different parent gives INCONCLUSIVE, never PASS. A wrong N gives argv mismatch, then INCONCLUSIVE. |
| Detects a genuinely absent watchdog | T4_L7_watchdog_dead (KILL; reaped): INCONCLUSIVE, the harness keychain is left for recovery, and the observer exits within its bound |
| Termination races | Harness already gone at observer start → INCONCLUSIVE. Zombie or reused PID → fails the argv/parent match → INCONCLUSIVE (fail-safe). Watchdog still alive after the deadline → INCONCLUSIVE. |
| No false PASS from a similarly named process | T4_L7_decoy; T4_L7_early_relock (a relock by another cause, simulated sleep) → INCONCLUSIVE |
| Negative paths | T4_L7_lock_fails → FAIL; T4_L7_obs_wait_bound → INCONCLUSIVE in ≤15 s; T4_teardown_cancels_watchdog → watchdog gone, CLEANUP VERIFIED |

**Conclusion (Task B).**
- The correction validates the **harness's watchdog logic and the observer decision logic against a simulated process view**.
- It does **not** validate the **production detection mechanism** (real `/bin/ps -ww -o command=/ppid=` output on macOS 14.6), because the sandbox forbids `/bin/ps` and unsandboxed scanning was not authorized.
- Production watchdog assurance therefore remains **unverified** (R2E-07 RE-4b). In REAL mode a format mismatch fails closed: the observer is INCONCLUSIVE and the watchdog is left to fire.

## 4. Named-pipe / runner regression (ticket Task C, all PASS)
| Requirement | Implementation | Test |
|---|---|---|
| Original failure reproduced, bounded | Write-only open on a reader-less FIFO | T6_fifo_old_pattern_hangs: blocks, is caught by a 2 s bound, and is killed by exact PID (`kills.txt`) |
| Reader available before writing | The runner opens the FIFO **O_RDWR**, so `open` never blocks and small writes are buffered | T6_fifo_reader_dies_early |
| Early reader termination | Harness exits before opening the FIFO | Ends in-bound with rc=1; the runner does not block |
| No reuse of stale pipes | `answers` and `spawn` always `rm -f` first | T6_fifo_stale: the precondition FIFO is replaced by a regular file and the run completes (rc=0) |
| Bounded waits | Every `run` is bounded (240 s default); `bwait` is used for spawn and observer; no unbounded `wait` remains | T6_run_bound: RC=124, the kill is recorded with its PID |
| Cleanup on success or failure | `unspawn` after each spawned scenario; the EXIT trap removes recorded FIFOs | FINAL: no named pipe left anywhere |
| Safe child termination | `killown` kills only a recorded PID that is a direct child of the runner with an R2D/R2E argv, or a watchdog whose argv names this work dir. A refusal is recorded. | FINAL: no test-owned process alive; 0 refusals |
| Clear failure, no hang | Timeouts become an explicit FAIL line (except where a timeout is the expected result) | Final run finished in 296 s |
