# FIX01-03: Fail-Closed Tests (mock regression suite)

**Command:** `/bin/zsh -f tests/r2e_selftest.zsh <empty dir>`, run in `AURA_GOV_02_RE4_FIX01`, unfiltered, 2026-11-14T10:42:43Z.
**Result:** runner exit **0**, **888 PASS / 0 FAIL**, 324 s.
- Kernel tripwire: query OK, positive control found, **0** sandbox denials of `security` exec, securityd mach-lookup or Keychains access.
- 3 expected T6 kills; 0 refused kills; no leftover process.
- The results header pins the v2 hashes, and they match the files.
- Copy: `evidence/mock_suite_run/`.

| Block | Checks | Fail |
|---|---|---|
| T0 tripwire | 24 | 0 |
| T1 Tier 1 (all R2E cases) | 235 | 0 |
| T2 Tier 2 | 237 | 0 |
| T3 signals | 30 | 0 |
| T4 L7 watchdog/observer | 67 | 0 |
| T5 bootstrap | 19 | 0 |
| T6 runner/FIFO | 16 | 0 |
| **T7 FIX01 scanner** | **249** | 0 |
| FINAL audit (now also checks `r2d-scan.*` residue) | 8 | 0 |
| KERNEL tripwire | 3 | 0 |

**Existing R2E regression coverage is preserved.** Every R2E scenario still passes on v2: T0–T6 = 628 checks (the R2E run had 638 including FINAL and KERNEL).

## UNKNOWN → STOP scenarios
Each asserts:
- a STOP with the specific reason;
- never `process scan CLEAN`;
- never the attestations;
- zero keychain-targeting calls;
- verdict `STOPPED (T1-6 process scan UNKNOWN)`;
- no scan temp file;
- no residue;
- the generic checks.

| Scenario | Fault | Reason asserted |
|---|---|---|
| T7_ps_rc_nonzero | ps exits 1 | `ucomm read: ps exit status 1` |
| T7_ps_rc_comm_only | only the second read fails (rc 3) | `comm read: ps exit status 3` |
| T7_ps_empty / _empty_comm | no output (rc 0) | `empty output` |
| T7_ps_malformed | non-row text | `malformed row` |
| T7_ps_blank_line | blank row mid-output | `malformed row` |
| T7_ps_partial_rows / _partial_comm | output truncated to 1 row | `implausible row count 1` |
| T7_ps_output_then_fail | valid rows, then rc 1 (the "pipeline component fails" analogue; v2 has no pipeline) | `ps exit status 1` |
| T7_ps_missing_column | row without a name | `malformed row` |
| T7_ps_bad_pid / _bad_ppid | `12a`, `-1` | `malformed row` |
| T7_ps_duplicate_pid | same PID twice | `duplicate pid` |
| T7_ps_no_launchd | PID 1 missing | `pid 1 (launchd) row missing` |
| T7_ps_own_row_missing | harness row missing | `own pid … row missing` |
| T7_ps_implausible_count | floor raised above the table size | `implausible row count` |
| T7_ps_timeout | ps hangs; bound 2 s | `exit status 124`; run < 20 s; hung mock ps killed; no leftover |
| T7_static_no_pipeline | static | no `\|`, no `\|\| true/:` in the block; `wait $p; PSRC=$?` present; default UNKNOWN |

**Not covered (review FX-6, P3):**
- mktemp failure;
- CR or odd bytes in a name;
- a `comm` value containing a newline.

Each of these would cause UNKNOWN or a false STOP, never a hidden hit (reviewer analysis).
