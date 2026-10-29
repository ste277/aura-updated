# V3-08: Synthetic Test Matrix and Results

**Final command:** `/bin/zsh -f tests/r2e_selftest.zsh <empty dir>` (cwd `AURA_GOV_02_RE4_V3_01`, unfiltered), run 2026-11-14T17:15:04Z.
- **Runner exit 0. 1092 PASS / 0 FAIL. 148 scenarios. 364 s.**
- The files were unchanged during the run, and the hashes in the results header equal the current files (V3-03).
- Three expected T6 kills (bounds tests); no refused kill.
- Kernel tripwire: query OK, positive control found, 0 hits.
- Copy: `evidence/synthetic_run_final/`. Interim superseded run: `evidence/synthetic_run_interim_999_superseded/`.

| Block | Checks | Fail |
|---|---|---|
| T0 tripwire (incl. kernel attribution unit tests) | 27 | 0 |
| T1 Tier 1 | 235 | 0 |
| T2 Tier 2 | 237 | 0 |
| T3 signals | 30 | 0 |
| T4 L7 | 68 | 0 |
| T5 bootstrap | 19 | 0 |
| T6 runner/FIFO | 16 | 0 |
| T7 scanner (fail-closed) | 251 | 0 |
| T8 V3 (diagnostics, timeout, capture, gate, V3R-4) | 198 | 0 |
| FINAL audit | 8 | 0 |
| KERNEL tripwire | 3 | 0 |

## Ticket §5 matrix → scenarios
| Scenario | Expected | Covered by |
|---|---|---|
| CLEAN before protected op | eligible | T7_clean_fixture, T8_diag_clean, T8_repeated_fresh_G1 |
| DETECTED before op | blocked | T8_clean_then_detected_create |
| UNKNOWN before op | blocked | T8_clean_then_unknown_unlock, T8_gate_timeout, T8_logfail_gate* |
| SuperOps present | DETECTED | T8_superops_present |
| CLEAN, then DETECTED | later op blocked | T8_clean_then_detected_unlock, T8_v3r4_detected_mid_run |
| CLEAN, then UNKNOWN | later op blocked | T8_clean_then_unknown_unlock |
| Repeated ops | fresh scan every time | T8_repeated_fresh_G1 (54 distinct gates) |
| Alternate entry point | gated | T8_alt_path_L13, T8_alt_path_L14_L6, T4_L7_pass (observer) |
| Dialog-capable error path | gated | T8_repeated_fresh_G1 (L4 locked add and delete), T8_alt_path_L13 |
| Read failure | UNKNOWN | T7_ps_rc_* |
| Malformed or partial table | UNKNOWN | T7_ps_malformed/partial*/blank/missing_column/bad_* |
| Missing scanner PID | UNKNOWN | T7_ps_own_row_missing |
| Timeout | UNKNOWN | T7_ps_timeout, T8_midline_stall, T8_gate_timeout |
| Failed diagnostic write | fail closed | T8_logfail_* (4 sites) |
| Invalid / mismatched / non-final marker | UNKNOWN | T8_spoof_sentinel, T8_no_trailing_newline |
| Gate bypass attempt | blocked | T8_v3r4_bypass_attempt / _bg / _pipe |

**Isolation.**
- Every harness run is sandboxed, with exec of `/usr/bin/security` and `/bin/ps` denied, under `env -i` with mock tools.
- The runner and mock touch the host process table only through exact-PID or known-parent queries.

## Incidents during the ticket (disclosed)
1. **Fixed: earlier T7/T8 failures.** The predecessor reported 7 failures (`404/7`; this ticket's text says 397/7), with these root causes:
   - **(a)** the nonce pipeline broke the scanner's no-pipe rule (3 static checks across runs);
   - **(b)** the zsh 5.9 SIGCHLD/malloc crash, which killed `T7_ps_own_row_missing` (5 checks);
   - test expectations not yet updated after V3R fixes.

   All are fixed.
2. **Stopped before it ran: a host-wide `ps -axo` listing.** I appended it to a verification command after the suite. The suite run was stopped before that step executed; the runner's exit trap killed one test-owned mock harness (PID 9368), identity-checked. It was rerun without the listing.
3. **Kernel tripwire false positive.** `identityservice` (PID 659), a system daemon denied by its own sandbox, matched the classifier. Attribution was first narrowed, then inverted on review (FR-4) to fail closed, with only named foreign daemons excluded.
