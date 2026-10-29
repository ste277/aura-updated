# R2E-02: Final Test Results — complete corrected mock-only run

**Classification:** every PASS here is a **simulated PASS**. It shows that the harness logic and controls behave correctly against simulators. It is **not** evidence about real macOS Keychain behaviour (see R2E-07).

## Run identity
| Item | Value |
|---|---|
| Command | `/bin/zsh -f tests/r2e_selftest.zsh <empty work dir>` (cwd `AURA_GOV_02_R2E`, **no filter**) |
| Started / finished | 2026-11-14T09:48:41Z / 09:53:37Z |
| Duration | 296 s |
| Runner exit status | **0** |
| Environment | macOS 14.6, zsh 5.9 (x86_64-apple-darwin23.0) |
| Isolation | Every harness run goes through `sandbox-exec` → `env -i` → `/bin/zsh -f`, with its own HOME, TMPDIR, mock copy and scripted answers |
| Sandbox profile | `(allow default)`, with these denials: exec `/usr/bin/security`; mach-lookup `com.apple.SecurityServer` / `com.apple.securityd` / `com.apple.securityd.xpc`; file-read/write of `$HOME/Library/Keychains` |
| Mode | SIMULATED-MOCK only. REAL mode was not executed. |

The files tested are pinned in the `results.txt` header, and those hashes equal the files in this directory:

| File | SHA-256 |
|---|---|
| r2d_prototype.zsh | `b9dd4d431a2864d31a55a017f1cf9f9ae551e9b9081881f4f90dd1ef0bf7c254` |
| tests/r2e_selftest.zsh | `b5bee634e9a4fa327e8da316e09eb1b159134cccc10350fb6fb2ad19c6c00446` |
| mock/security | `eacac7ca3eb8eb8c5d696e71d749b7d1d2841583a01c71ee922cef7dbd65370d` |
| mock/ps | `9a51e10d4256c25535f28da7d7112127d7fa192120a2e93924c9172e0e9cb838` |
| mock/pmset | `6218a34394b5e220e0ae6e581ac15ad852df8dde739e9d3932e748b1d4d4cdd2` |
| mock/csrutil | `004b99bae32bd2013f26a9ebeebbb48864ca47b595e5b59579438e5088af111f` |

## Totals: **638 checks, 638 PASS, 0 FAIL, 0 skipped**
There are 95 scenarios and 103 harness/observer logs.

| Block | Content | Checks | Fail |
|---|---|---|---|
| T0 | Tripwire self-checks: deny profile, text and kernel classifier unit tests, live kernel positive control (dummy binary), profile validity, subpath deny control, static literal-path check | 24 | 0 |
| T1 | Tier 1 controls T1-1…T1-9 (positive and negative), mock-dir spoofing, argument/ID validation, static REAL-mode ordering | 235 | 0 |
| T2 | Tier 2: G1 and L1–L15, positive and fault-injected negatives (L4 overwrite/silent-write/no-baseline, L8 pass/reset/early-lock/no-probe/no-autolock, …) | 237 | 0 |
| T3 | INT / TERM / HUP during G1 → trap teardown | 30 | 0 |
| T4 | L7 watchdog/observer: pass, dead watchdog, decoy, wrong N, harness gone, wait bound, lock fails, early relock, mode mismatch, path guard, teardown cancels watchdog, no probe, bad args | 67 | 0 |
| T5 | R2D-06 bootstrap integrity | 19 | 0 |
| T6 | Runner / named-pipe regressions | 16 | 0 |
| FINAL | Whole-work-dir cleanup audit | 7 | 0 |
| KERNEL | Fail-closed kernel tripwire over the whole run window | 3 | 0 |

**Skipped checks:** none. The runner has no skip mechanism; every check either runs or the scenario fails.

**Expected kills:** 3, recorded in `kills.txt`. All three are T6 scenarios that deliberately exceed a bound:
- PIDs 49912 and 50729 were killed on purpose to test the bounds.
- PID 51281 was that scenario's watchdog.

No refused kill ("NOT killed") was recorded.

**Unexpected errors:** none in the final run.

## History (preserved; not overwritten)
| Run | Harness | Result | Notes |
|---|---|---|---|
| run7 (R2E) | earlier | T1 219/219 | Before the R2E-FINAL fixes |
| r2e_full1 | earlier | Hung at T4_L7_watchdog_dead; L7 checks FAIL | Root causes in R2E-03. Hung PIDs were killed by exact PID. |
| r2e_final1 | `9f40ce8c…` | 555/0 | Before L4 hardening and before the review fixes |
| r2e_rv1 | after review fixes | 624/11 | Test-fixture defects (regex `[`…`]`, missing stdout capture) plus one harness bug (duplicate-ID check). All fixed. |
| r2e_rv2 | `a2fa9905…` | 634/0 | Re-reviewed. Then the N-1…N-6 fixes followed. |
| **r2e_FINAL** | **`b9dd4d43…`** | **638/0** | **Evidence of record:** `evidence/r2e_final_run/` |
