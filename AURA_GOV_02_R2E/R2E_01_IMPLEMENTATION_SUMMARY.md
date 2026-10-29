# R2E-01: Implementation Summary — Locked-Keychain Prototype Harness

**Tickets:**
- AURA-GOV-02-R2E: implementation and mock-only validation.
- AURA-GOV-02-R2E-FINAL: completion, independent review and evidence closure.

**Status:** implemented and validated against simulators only.
- **Prototype execution: NOT AUTHORIZED.**
- **REAL mode: never executed** in the final evidence.

## What was and was not touched
- No real Keychain was created, unlocked, locked, deleted or read.
- The real `/usr/bin/security` was never executed.
- No credential was requested.
- **Evidence (final run `evidence/r2e_final_run/`, on the hashes in R2E-02):**
  - The kernel sandbox log for the whole run window holds **zero** denials. That covers exec of `/usr/bin/security`, mach-lookup to `com.apple.SecurityServer`/`securityd`, and access to `$HOME/Library/Keychains`.
  - A positive control inside that same window *was* detected, so the query works.
  - The stderr text tripwire found nothing in any scenario.
- **Disclosure:** runs made *before* R2E-FINAL included scenario `T1_20_unpinned_real`. It launched the harness in REAL mode under the sandbox, and the harness stopped at T1-4 (UNPINNED) before any `security` call. That scenario was **removed** and replaced by a static ordering check, so no REAL-mode execution remains anywhere in the runner.
- No Neon, Vercel, production launcher, R-1, B4, B5 or B6 action was taken.
- Nothing was committed, merged, pushed or deployed.

## Components and exact files
| Path | Purpose |
|---|---|
| `r2d_prototype.zsh` | The harness: Tier 1 T1-1…T1-9, Tier 2 L0–L11 and L13–L15, L16POST, and L7 observer mode. **L12 is partial** (see below). |
| `mock/security`, `mock/ps`, `mock/pmset`, `mock/csrutil` | Stateful simulators, selected with `R2D_MOCK_DIR`. Each carries the marker line `# MOCK <tool> for R2E`. |
| `tests/r2e_selftest.zsh` | The self-test runner: 95 scenarios / 638 checks, with a sandbox, bounded waits and a final cleanup audit. |
| `evidence/r2e_final_run/` | Final run output: `results.txt` (with a provenance header), `kills.txt`, `kernel_sandbox_security.txt`, and 103 scenario logs. |
| `R2E_01` … `R2E_07`, `R2E_FINAL_GATE_REPORT.md`, `SHA256SUMS` | The deliverables. |

No production code, launcher, R2B/R2B-6/R2C/R2D artifact or `r2b_isolated.zsh` was modified.

## Corrections made under R2E-FINAL (all mock-scope)
| Area | Change |
|---|---|
| Watchdog cancel (real defect) | Teardown sent TERM to a watchdog that ignores TERM **by design**, so cancellation never worked. It now sends KILL, after an exact identity check (`is_wd`: PID, argv tail ` r2d_watchdog N <kc> <sec>`, and parent = harness). |
| L7 observer | Bounded wait for the harness kill (`OBSW`, 900 s in REAL). The harness must be alive at observer start, and the watchdog identity must match exactly. **PASS** additionally needs: an unlocked residual at t+5 when N>5, the watchdog gone by the deadline, and a matching mode field (8th argument). |
| `ps` usage | All calls use `-ww` (unlimited width). The previous `*r2d_watchdog*` match was exposed to column truncation. |
| Mock `ps` | Exact-PID argv lookup and true parent lookup via `pgrep`. This is needed because `sandbox-exec` refuses the setuid `/bin/ps`. |
| Mock guard (review RV-1) | `mockok` requires each mock to be a regular, non-symlink, executable zsh script with the marker line, outside system directories. `R2D_MOCK_DIR=/usr/bin`, `/usr//bin`, `/usr/bin/../bin`, symlinks and foreign binaries are all refused. |
| REAL hardening (RV-2) | REAL mode refuses any `R2D_*` variable and ignores the answers file. |
| Path guard (RV-6) | Exact `$TMPDIR/r2d-run.<8 alnum>/r2d.keychain-db`. Paths with `..` or glob characters are refused. |
| Arguments (RV-7) | Each flag may appear once, `--observe` and `--test` are exclusive, test IDs must match a strict regex, and duplicate IDs are refused. All of this is checked before any `security` call. |
| L4 (RV-8) | The locked `mdat` read happens only if `attr` qualified in L1. The pre-write state must be `locked`; if no probe is calibrated, the "by construction" basis is logged. A 1.1 s spacing follows the baseline. **FAIL** on: overwrite rc=0, delete rc=0, item gone, or `mdat` changed. **INCONCLUSIVE** if no `mdat` can be read before or after. `lock_ctl` return codes are checked everywhere (N-2). |
| L8 (RV-3) | **PASS** requires the T/2 probe to have observed `unlocked`; otherwise INCONCLUSIVE. Labelled "single trial". |
| Mode labels (RV-9) | Every verdict line is `R2D VERDICT: [SIMULATED-MOCK|REAL] …`, and the header logs `mode=`. The observer refuses a mode mismatch. |
| Runner | O_RDWR answers FIFO; bounded `run`/`bwait`; a kill registry that only kills **provably test-owned** PIDs (direct child of the runner, or a watchdog naming the work dir); an EXIT trap; a final cleanup audit; a provenance header; and a fail-closed kernel tripwire. |
| `RES`/`ANS`/`DLG` globals | They had been declared inside a comment by mistake. Now properly declared. |

## Deviations from R2D (recorded)
1. The bootstrap passes the harness arguments after `r2d_prototype`.
2. The probe is chosen once in L1 and passed later with `--probe=`. Without it, lock state is `unknown`, and L7, L8 and L9 cannot PASS.
3. The L7 observer is the same harness running in `--observe=` mode. It takes **8 fields**, including the mode.
4. L4 takes its baseline `mdat` through a controlled unlock, unless `attr` qualified.
5. Mock-only hooks (`R2D_WD_N`, `R2D_L8_T`, `R2D_OBS_WAIT`, `R2D_TEST_EMPTY_KC`, `R2D_MOCK_*`) are **refused** in REAL mode.
6. The watchdog argv is `r2d_watchdog <N> <kc> <security path>`, and it runs `security lock-keychain -- <kc>`. Whether real `security` accepts `--` is unverified (RE-10).
7. **L12 is partial.** `dlg` records the dialog type, whether a password was asked (and which), and the owner's action. It does **not** capture R2D-03's "names `security`" or "names keychain/item" fields (RE-9).
