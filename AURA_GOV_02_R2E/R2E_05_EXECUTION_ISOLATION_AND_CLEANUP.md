# R2E-05: Execution Isolation and Cleanup Report

## 1. Mock-only execution
**Barriers on every harness run:**
- **Sandbox:** `sandbox-exec` with the profile in R2E-02. It denies exec of `/usr/bin/security`, mach-lookup to securityd, and the real Keychains directory.
- **Clean environment:** `env -i` with an explicit, minimal environment, then `/bin/zsh -f`.
- **Per-scenario state:** each scenario has its own HOME and TMPDIR, and its own copy of the mocks.
- **Hardcoded path:** `/usr/bin/security` appears in the harness only in the REAL-mode assignment. This is checked statically in T0.

**Mock-dir spoofing** (RV-1, T1_21): `R2D_MOCK_DIR` set to `/usr/bin`, `/usr//bin`, `/usr/bin/../bin` or `/usr/bin/`, or pointing at a symlinked tool, a foreign binary or a symlinked dir, is **refused before any call**. Zero mock calls are logged.

**Two-layer tripwire:**
1. **Stderr text.**
   - Checks every scenario's stdout/log for `security` exec denials.
   - Missing stdout evidence counts as NOT clean.
   - Unit-tested both ways: a blocked `/bin/ps`, unrelated EPERM, `security-notes` and `/opt/security-scanner` are not classified; zsh, sandbox-exec and env denials of `security` in both word orders are classified.
2. **Kernel sandbox log.**
   - Runs on every run, independent of stderr redirection.
   - Classifies exec of `/usr/bin/security`, mach-lookup of SecurityServer/securityd, and file access to the real Keychains dir.
   - **Fail-closed:** `log show` must return rc 0 with a header, and a stderr-suppressed **dummy** denial inside the window must be found.
   - **Final run:** query OK, positive control found, **zero real hits**.

**Not tested:** the mach-lookup deny has a string check and a profile-validity check, but no functional control. A functional control would need a Security.framework client, which was avoided.

## 2. Mode labels and input validation (Task H)
- **Mode in every log.** Header `mode=SIMULATED-MOCK|REAL`. Every verdict is `R2D VERDICT: [<MODE>] …`. In the final run, all 103 logs carry `[SIMULATED-MOCK]` and the same harness hash.
- **No silent mode switch.**
  - MODE is derived once, from `R2D_MOCK_DIR`.
  - REAL mode refuses every `R2D_*` variable, so mock hooks and answer files cannot leak into a real run.
  - The L7 observer refuses a harness of a different mode (T4_observer_mode_mismatch).
- **Arguments.** Unknown or duplicate flags, `--observe` together with `--test`, malformed lists (`,`, `G1,`, `g1`, `G1,,L7`), duplicate IDs (`G1,G1`) and unknown IDs (`L99`) are all rejected **before any `security` call**. Calls are logged as zero (T1_17, T1_18, T1_25).
- **Preflight fall-through.** Every preflight failure is `stop` (exit 2) or `exit 1`. There is no path from a failed check to a `security` call, and REAL mode adds the T1-4 UNPINNED stop.
- **The `[REAL]` label exists in the code but was never produced.** No REAL-mode test was executed in the final runner (T1_20 is now static). R2E-01 discloses one earlier sandboxed REAL-mode launch.

## 3. Cleanup (Task I)
| Resource | Per-scenario control | Final audit (whole work dir) |
|---|---|---|
| Throwaway (simulated) keychains | Deleted after every group, including G1 and L16POST's own; a failed delete means STOP. Crash scenarios run R2D-07 manual recovery with explicit paths, every step checked. | No `r2d.keychain-db` file or mock state left: PASS |
| Run dirs and lock dirs | `rmdir` only; lock removed only if this run created it | None left: PASS |
| Watchdog processes | Teardown cancels by exact identity; crash tests wait for firing or kill by PID | None referencing the work dir: PASS |
| Harness / observer / decoy / writer processes | Bounded waits; owned-PID registry | None alive: PASS. Host check afterwards: 0 matching processes. |
| Named pipes | `unspawn`, plus `rm -f` in the EXIT trap | None: PASS |
| Synthetic secrets | The mock records every value it receives, including rejected L4 values | No value in any log, stdout or argv log: PASS |
| Unexpected background processes | — | None found after the run |

**Scope.** Cleanup touched only resources created by the harness or runner under the scenario work dirs. No unrelated keychain, file or process was deleted. The 3 kills in the final run were intentional T6 test-owned kills. The earlier hang cleanup is listed in R2E-03.

**Retention.** The test work directories remain in the session scratchpad as raw evidence. They hold only simulated state; the record copy is `evidence/r2e_final_run/`.
