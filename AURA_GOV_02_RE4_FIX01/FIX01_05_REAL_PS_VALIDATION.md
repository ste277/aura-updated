# FIX01-05: Real `/bin/ps` Validation

All of this was read-only: one bounded test-owned dummy, no `security`, no Keychain, no signal to any other process.

## Survey (`probes/fix01_survey.zsh`; `evidence/fix01_survey.log`; exit 0)
- `ps -ww -axo pid=,ppid=,ucomm=` and `…comm=` both rc 0, 605 rows each. ucomm is at most 16 chars, and the real output is space-padded to 16.
- Denylist matches agree in both columns: ChatGPT for Chrome, Claude, Claude Helper (×8), Claude Helper (Renderer) (×2), claude (×6), superops (×2). There are 0 matches unique to either column.
- **SuperOps identified read-only** (it was not signalled, unloaded or altered):

| Property | Value |
|---|---|
| Executable | `/Library/superopsrmm/bin/superops`; Mach-O arm64; owner root:wheel, mode 755 |
| Signature | Developer ID Application: **Superops Inc. (Team ID 4SPX8Y4YUX)**, Apple-anchored chain; `codesign --verify --strict` rc 0 |
| Gatekeeper | `spctl --assess --type execute` reports "rejected". This is common for non-bundle CLI binaries; it is recorded, not interpreted. |
| Processes | pid 510 (user root, parent launchd); pid 16883 (user stephen, parent launchd) |
| Launch context | LaunchDaemons `com.superopsrmm.rmm` (KeepAlive, RunAtLoad; runs `superops`), `com.superopsrmm.updatemgr` and `com.superopsrmm.UpgradeScheduler` (run `updmgr`); LaunchAgent `com.superopsrmm.systemtray` |

  This is a system-wide **SuperOps RMM** (remote monitoring and management) installation: a commercially signed agent that offers remote-access capability. This report makes **no judgement** about whether it is malicious or legitimate. Whoever administers the Mac should confirm its provenance. While it runs, T1-6 correctly STOPs.

## v2 scanner on the real host (`probes/fix01_real_probe.zsh`; `evidence/fix01_real_run.log`)
**Command:** `/bin/zsh -f probes/fix01_real_probe.zsh r2d_prototype.zsh 4b7e4890… evidence <scratchpad>/fix01_tmp_<rand>`
**Result:** exit **0**, **22 PASS / 0 FAIL**, 25.6 s. The exact v2 scanner block (37 lines) was extracted from the hash-checked v2 harness.

| ID | Real observation | Result |
|---|---|---|
| R-1a/b/c | Real table validated (474 rows); **DETECTED**; both `ucomm:` and `comm:` hits | PASS |
| R-2a | Dummy pid 53197, parent = driver, exact argv | PASS |
| R-2b | `comm` = `/fix01/osascript-fix01dummy` (caller-chosen argv[0]) | PASS |
| **R-2c** | **`ucomm` = `zsh`: the kernel name of the executed file, NOT argv[0]** | PASS |
| R-2d/e | v2 reports the dummy only as `comm:osascript-fix01dummy`, never `ucomm:` | PASS |
| R-2f | Dummy excluded when it is the scanner's direct child | PASS |
| R-3a | `PSB=/usr/bin/false` gives UNKNOWN (`exit status 1`) | PASS |
| R-3b | Nonexistent PSB gives UNKNOWN (`exit status 127`) | PASS |
| R-3c | `PSB=/usr/bin/true` (rc 0, empty output) gives UNKNOWN (`empty output`) | PASS |
| R-3d | Real table below the floor gives UNKNOWN (`implausible row count`) | PASS |
| R-3e | Own PID not in the real table gives UNKNOWN | PASS |
| E-1/2/3, F-1/2 | Dummy exited naturally at 25.1 s (status 1), **no signal sent**; afterwards ps rc 1 with no record and no longer reported; temp dir removed; no marker process (`pgrep` rc 1) | PASS |

**Probe attempt 1** (`evidence/fix01_real_run_attempt1.log`, 21/1) is kept:
- R-2d failed because it disabled the exclusion with a non-existent `ME`, and v2 correctly answers UNKNOWN when its own row is missing.
- E-3 used the same trick and passed vacuously.
- Both were rewritten to use `ME=1` (a real row) and to require `SCAN != UNKNOWN`.

**Not demonstrated on real macOS (review FX-2):** the RV4-2 direction itself (denylisted executable, benign argv[0]). It follows from R-2c and is covered by mock T7_comm_spoofed_benign. A real test would need a denylisted executable launched under a benign argv[0]. The available route is a copied platform binary, which macOS killed in RE-4. That route was not attempted, to avoid running automation tooling.

**No real CLEAN result was possible.** Claude, ChatGPT for Chrome and SuperOps are running, so RV4-3 is still open.
