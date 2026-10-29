# RR01-02: STOP-Path Safety Review (before execution)

| # | Requirement | Finding (v2 harness line numbers) |
|---|---|---|
| 1 | Exact v2 path | Preflight: `df` (173), lock `mkdir` (174), `csrutil status` (175). **T1-6:** `t16_scan` (219) then `case $SCAN in` (220–224). The first protected operation comes after it: `glob_state` (229, the first `security` query), then `mktemp`/create (233+). |
| 2 | No continuation after DETECTED or UNKNOWN | `DETECTED) stop …` (222). `*) VERDICT=…; stop …` (223) covers UNKNOWN and anything else. `stop()` = log plus `exit 2` (55). Only `CLEAN` falls through. |
| 3 | No `security` on this path | Nothing before line 229 invokes `$SEC`. On a stop, the EXIT trap `cleanup()` (100–118) reaches `sec_kc` only if `kc_ok` (KC is empty), `glob_state` only if `SL0` is set (empty), and the watchdog/child kills only if `WDPID`/`PIDS` are set (both empty). So it never reaches `security`. |
| 4 | No Keychain folder or credentials | None needed. |
| 5 | No signals to unrelated processes | The only signal in the scan block is `kill -KILL $p`, sent to **its own ps child** on a 10 s timeout. Cleanup's `pkill -P`/`kill` loops have nothing to act on (empty `PIDS`). |
| 6 | Timeout and PID reuse | `SCANTO` = 10 s, fixed in REAL mode (38). FX-3 (a reused PID could be killed on timeout) is unchanged and accepted for this run. If the timeout fires, the result is UNKNOWN, never DETECTED. |
| 7 | Temp-file isolation | The real harness stages ps output in `$TD` (`/tmp` under `env -i`) with umask 077 (mode 600); FX-4 stays open. **This run** used a private mode-700 directory instead. That isolates the run, but it is **not** evidence that FX-4 is closed. |
| 8 | No admin rights or MDM change | None. |

**Chosen entry point (no dummy, no extra application).**
- `probes/rr01_stop_probe.zsh` extracts the pinned block, scanner **plus** case **plus** `stop`, and `eval`s it in a subshell standing in for the harness process.
- Its settings match REAL mode: `ME=$sysparams[pid]` (so its own ps children are excluded, as in the harness), `PSB=/bin/ps`, `SCANMIN=20`, `SCANTO=10`.
- Every Keychain-reaching harness function is a **TRIPWIRE** stub that logs and exits 99: `sec_kc sec_i sec_global glob_state create ask unlock_ctl lock_ctl`.
- A **SENTINEL** line runs only if execution continues past T1-6.
- The probe refuses to run on a hash mismatch, or if the block lacks the scan, case and stop, or references a protected operation.

The real harness itself was not executed. In an actual REAL launch, the T1-4 UNPINNED stop and the `R2D_*` refusal stop even earlier (reviewer RR-3), so neither could turn a STOP into a continue.

**Decision:** the STOP path is reliably isolated. GO.
