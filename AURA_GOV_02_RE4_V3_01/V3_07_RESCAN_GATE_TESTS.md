# V3-07: Fresh-Scan Gate (FX-5 + V3R-4)

**Rule.** Every dialog-capable keychain operation runs **in the harness process**, immediately after a **new** validated scan. Only CLEAN allows that one operation; DETECTED and UNKNOWN stop the run. **There is no reuse:** each gate is a new scan id with `SCAN` reset to UNKNOWN.

## V3R-4 operation inventory and coverage
| Op | Entry points | Gate |
|---|---|---|
| create-keychain | `create()` | `sec_kc` |
| unlock-keychain | `unlock_ctl`, L13 wrong-passphrase, L14 second unlock | `sec_kc` |
| set-keychain-settings | `setkc` | `sec_kc` |
| show-keychain-info | `setkc` verify; probe `info` (L1, pstate, observer) | `sec_cap` |
| dump-keychain | `acl_of` (`-a`), probe `dump`, L3 (`-d`) | `sec_cap` |
| find-generic-password | `readA` (`-w`), probe `attr`, `mdat`, L4 presence check, L5 readers | `sec_cap` / `sec_kc` / `sec_bg_pair` |
| delete-generic-password | L4 | `sec_kc` |
| add-generic-password | `create()` items, L4 overwrite | `sec_i` |
| lock-keychain, delete-keychain, list/default-keychain | teardown, watchdog, `glob_state` | not dialog-capable, so not gated |

## Results (final run, all PASS)
| Scenario | Shows |
|---|---|
| **T8_repeated_fresh_G1** | **54 gates = 54 gated calls** reaching security, covering all **8 op types** (create 1, unlock 8, settings 1, show-info 7, dump 9, find 25, delete 1, add 2); **54 distinct gate ids** (no reuse); no call without a gate; every call after its gate scan; error paths gated (locked add and delete in L4); L5's two secret reads on two adjacent gate ids |
| T8_clean_then_detected_create / _unlock | CLEAN preflight, then DETECTED at a later gate: that op blocked, never reached security; earlier ops did |
| T8_clean_then_unknown_unlock | A later UNKNOWN blocks the unlock |
| T8_v3r4_detected_mid_run | DETECTED mid-G1: the next dialog op (whatever it is) is blocked (gate scan 11 never reached security) |
| T8_gate_timeout | Timeout inside a gate gives UNKNOWN, op blocked |
| T8_alt_path_L13 | Direct wrong-passphrase unlock (error path) gated |
| T8_alt_path_L14_L6 | Multi-group: every dialog call gated |
| T4_L7_pass | The L7 observer's probes are gated in the observer process |
| **T8_v3r4_bypass_attempt / _bg / _pipe** | Dialog op from `$(…)`, `( ) &` or a pipeline: **refused (not performed)** and recorded; the parent STOPs (`STOPPED (gate bypass attempt detected)`) |
| T8_static_choke_point | Every `$SEC` reference is on 7 audited lines; `sec_kc`/`sec_cap` gate first; `sec_bg_pair` order; the exact `dlgop` inventory; no keychain helper in `$(…)` except the mock-only hook; no backticks; no `eval` of SEC; the profile denies `/bin/ps` and `security` |
| T8_superops_present | SuperOps is DETECTED (T1-6 refusal preserved) |
