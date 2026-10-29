# R2D-07: Cleanup and Recovery Plan

## Deterministic teardown (idempotent; on EXIT, INT, TERM, HUP and every STOP)
1. **Reap children:** kill and reap only the child PIDs recorded by this run (ppid = harness), including reader helpers.
2. **Watchdog:** it runs as its own exec'd process with the short argv `r2d_watchdog <N> <our path>` (review P1-2). Cancel it only if the recorded PID still shows that exact argv. Otherwise let it fire: it only locks our throwaway path.
3. **Lock:** `security lock-keychain <path>`, then probe (if validated) and record the state.
4. **Delete:** `security delete-keychain <path>`, then verify the file is absent.
5. **Remove:** remove only our temp files (reader results) and the private directory (`rmdir`, never `rm -rf` on a variable path).
6. **Verify global state:** the search list (user / dynamic / common / system) and the default keychain (user / system) must equal the baseline.
7. **Release the lock directory** only if this run created it.
8. **Log** `R2D CLEANUP: VERIFIED` or `UNVERIFIED`, then `R2D VERDICT: …`, then the log path. Warn on screen if the log didn't record the verdict.

## Crash or SIGKILL (teardown can't run)
- **Residual:** the throwaway keychain may remain **unlocked** until the watchdog fires (N seconds), `-t` elapses, or sleep.
- **It holds synthetic values only**, so the impact is nil for the prototype. **This is exactly what L7 measures.**

**Manual recovery** (printed by the harness at start, so it is visible even after a crash):
1. Look for directories `$TMPDIR/r2d-run.*` (the lock directory is named `$TMPDIR/r2d-lock`, so it doesn't match). Each should contain only `r2d.keychain-db` and the named reader-result files `ra`/`rb`.
2. For each: `security lock-keychain <dir>/r2d.keychain-db`, then `security delete-keychain <dir>/r2d.keychain-db`, then `rm -f <dir>/ra <dir>/rb`, then `rmdir <dir>` (the owner runs these; always with the explicit path).
3. `security list-keychains -d user` (and dynamic/common/system) must equal the **baseline logged at start**. If an `r2d` path appears, `security delete-keychain` removes it from the list.
4. Remove a stale `$TMPDIR/r2d-lock` directory only if the harness PID recorded in the log is no longer running (`kill -0 <PID>` fails). Never identify it by `pgrep -f`.
5. Never delete anything that isn't an `r2d` artifact.

## Failure handling

| Situation | Action |
|---|---|
| Tier 1 failure | NO-GO before creation; nothing to clean except the lock |
| Create fails | teardown; verify nothing remains |
| Unlock fails or is cancelled | keychain stays locked; continue the cleanup |
| Unexpected dialog / login-password request | owner Cancel; STOP; teardown |
| Delete fails | `CLEANUP: UNVERIFIED`; HOLD; manual recovery |
| Global state changed | STOP; HOLD; report; **no automatic correction** (the owner decides) |
