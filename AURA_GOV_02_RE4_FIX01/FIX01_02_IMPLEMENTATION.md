# FIX01-02: Implementation

## Files (all in `AURA_GOV_02_RE4_FIX01/`)
| File | SHA-256 | Change vs R2E original |
|---|---|---|
| `r2d_prototype.zsh` (harness v2) | `4b7e48900fb09b2b9bddda6e2306f284233178e59b5ebc2fd247fd32b2510d95` | T1-6 block replaced (lines 177–224); new globals (38–39); cleanup also removes `r2d-scan.*` temp files (112). Nothing else changed (reviewer diff-verified). |
| `mock/ps` | `de5d1091b4d7f642c3f1d7d0dc3f34c9cbb45715a9df32844ad3c3e00cc33ba6` | Simulated `ucomm` table (space-padded to 16, like real) and `comm` table, plus fault injection. The stdin hang when no log exists is fixed. |
| `tests/r2e_selftest.zsh` | `b8287091c6294f6a8086fba41f262436d537db3d9de84781581b4a9b3f3bd002` | New block 7 (T7, 31 scenarios). FINAL audit checks for `r2d-scan.*` residue. Two T1 expectations updated to the new hit format; the reviewer confirmed they are **stricter**. |
| `mock/security`, `mock/pmset`, `mock/csrutil` | unchanged copies | — |
| `probes/fix01_survey.zsh` | `af26a7df…` | New: read-only survey (comm/ucomm, SuperOps identity) |
| `probes/fix01_real_probe.zsh` | `c427df77364795eb3d1889f0b0e15de0adb4670d0e77ee1ae064d54d43e81ad0` | New: real `/bin/ps` validation of the exact v2 scanner |

## v2 T1-6 design
1. **Two bounded reads.** `ps_read ucomm`, then `ps_read comm`. Each runs `"$PSB" -ww -axo pid=,ppid=,<col>=` with output to a fresh `mktemp` file, in the background. The read polls `kill -0` against a deadline (`SCANTO` = 10 s, fixed in REAL mode). On timeout it sends `kill -KILL` to **its own ps child only**, and the result is rc 124. The exit status is captured with `wait $p; PSRC=$?`. **There is no pipeline and no `|| true`** (statically checked).
2. **Validation (`ps_parse`).** Any of the following makes the scan UNKNOWN:
   - rc ≠ 0;
   - empty output;
   - any row not matching `^ *<pid> +<ppid> +<name>$` (this catches blank rows, missing columns, bad PID, negative PPID);
   - a duplicate PID;
   - fewer than `SCANMIN` rows (20 in REAL);
   - no row for PID 1 (launchd);
   - no row for the harness's own PID.

   Trailing `ucomm` padding is trimmed.
3. **Identity.**
   - `ucomm` is the kernel process name, taken from the executed file's name (max 16 chars). The caller cannot set it through argv[0]; this is verified on real macOS (FIX01-05 R-2c).
   - `comm` is derived from argv[0] and is caller-controlled.
   - **Both are scanned. A denylisted token prefix in either one means DETECTED.** A spoofed benign argv[0] therefore no longer hides a denylisted executable, and a denylisted argv[0] still STOPs (conservative).
   - The denylist is a literal token list, so the old unescaped `zoom.us` regex is gone.
4. **Exclusion.** The harness's own PID is excluded, and so is a direct child, but **only if both reads agree** that its parent is the harness. A disagreement means the process is scanned. Grandchildren are scanned.
5. **Outcome.**
   - `SCAN` starts as UNKNOWN and becomes CLEAN only after both reads validate and nothing matches.
   - CLEAN logs `T1-6: process scan CLEAN (ucomm+comm validated, rows=N)` and goes on to the attestations.
   - DETECTED stops with `T1-6: UI-automation / remote-control process running: <src:name;…>`.
   - Anything else stops with `T1-6: process scan UNKNOWN (<reason>) - not treated as clean` and the verdict `STOPPED (T1-6 process scan UNKNOWN)`.
   - Detected processes are **never signalled**.
