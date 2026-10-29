# RE4-05: Cleanup and Isolation

## Signals
- **Dummy 57728:** `kill -0` liveness tests only. It **exited naturally**. The TERM path, which requires an exact `command=` match and parent = driver, was **not taken** (`E-2 signal sent to dummy: no`).
- **Every other process: no signal of any kind** at any point. There was no `pkill`, `killall`, name-based or broad signalling.
- **Attempt 2:** the dummy was killed **by macOS** (SIGKILL, status 137), not by the probe.

## Temporary artifacts (exact, guarded paths)
- **Attempt 3:** the probe created only `<scratchpad>/re4_tmp_bc60bd11/` (mode 700). The dummy's `KC`/`SEC` paths beneath it were never created. Removed with `rmdir -- "${T:?}"`. F-1 confirms it is absent.
- **Attempts 1 and 2:** each created a `re4_tmp_*` dir holding a copied zsh binary at `bin/osascript-re4dummy`. Each was removed by the probe's own exact-path cleanup.
- **After all attempts:**
  - `ls -d <scratchpad>/re4_tmp_*` found no match;
  - `pgrep -f RE4-MARKER` returned 1 (no process);
  - `pgrep -f osascript-re4dummy` returned 1.
- **Shell safety check.** An earlier draft's cleanup used an unguarded `$T/bin` path, and Claude Code's shell safety check refused that command. It was rewritten with `"${T:?}"` guards. The refused command never ran.

## Isolation
- **No Keychain operation.** No `security` or other Keychain tool was invoked.
- **No file opened under `~/Library/Keychains`.**
- **No network, no admin rights, no launchd change, no settings change.**
- **No harness, R2E suite or Tier 2 execution.**
- **No PALM data touched.**

**Unchanged:**
- **R2E package:** 120/120 still verify, and its manifest is unchanged.
- **Harness:** SHA-256 `b9dd4d43…` is unchanged.

## Redaction
- The full process listing was never stored; only counts were kept.
- Real hits are recorded as executable basenames only, with no arguments.
- The log contains the dummy's own argv, which includes the local username and session UUID in the scratchpad path (review RV4-9, P3, accepted).
