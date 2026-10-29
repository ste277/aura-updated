# V3-03: Implementation Diff (v2 → v3)

## Final files
| File | SHA-256 |
|---|---|
| `r2d_prototype.zsh` (v3 candidate, 513 lines) | `5197b041e6652de4f1593d24513b65ac1e338d2a964b84f8273801c73bef6681` |
| `tests/r2e_selftest.zsh` | `5443c1b4180c5dae75af0ecbeb9fbd637f657b9b12027d1098a375f1b08b1159` |
| `mock/security` | `6bf99bbd53570ba28d5854111276fdb9b9fc34400c374915842fb5007e8fd902` |
| `mock/ps` | `e5bf9bdc65fc92c4afd64ee1dce47e5fbc698ad1c762963f3d43bc4ee45ebf9a` |
| `mock/pmset`, `mock/csrutil` | unchanged from FIX01 (`6218a343…`, `004b99ba…`) |

## Full diffs
All against `AURA_GOV_02_RE4_FIX01/`, stored in `evidence/`:
- `v2_to_v3_harness.diff` (406 lines)
- `v2_to_v3_runner.diff` (170)
- `v2_to_v3_mock_ps.diff` (35)
- `v2_to_v3_mock_security.diff` (3)

## Harness changes
1. **Globals and modules.** `zsh/parameter` is loaded. `SCANMAX` is added, with counters `SCANID` and `DIAGN`. Mock-only overrides are validated as numeric (`<->`), so no environment text is evaluated as arithmetic (V3R-7).
2. **Scanner block, moved above observer mode** so the observer's probes are gated too:
   - `diag` (fails closed);
   - `r2d_nonce` (8 bytes via `sysread` from `/dev/urandom`, hex-encoded with builtins, 0–255 guard);
   - `ps_read` (disowned coprocess with a nonce sentinel that must be the exact final line, `sysread` with a whole-read deadline, byte and row bounds, no signal, no file);
   - `ps_parse` (counts rows, duplicates and malformed rows; reason-ordered UNKNOWN);
   - `t16_scan` (deduplicated PID walk; scanner-PID and exclusion counts);
   - `t16_decide` (preflight messages identical to v2);
   - `gate_ledger`;
   - `t16_gate`.
3. **Dialog-capable choke points (V3R-4).** `dlgop` inventory; `sec_kc` routes dialog ops through `main_only` → `t16_gate` → `secx`. Also `sec_cap` (main-shell capture), `sec_i` (gated, rejects LF/CR), `sec_bg_pair` (L5: two gates, then two readers) and `secx` (the only `$SEC` call for dialog ops; in mock mode it tags each call with its gate id).
4. **Helpers converted to main-shell functions:**

   | Function | Sets |
   |---|---|
   | `probe` | `PRB` |
   | `readA` | `RDA` |
   | `acl_of` | `ACL` |
   | `mdat` | `MDT` |
   | `pstate` | `PST` |

   `setkc` and L3 use `sec_cap`. All 39 former `$(…)` call sites and 3 pipelines were converted in place, keeping evaluation order.
5. **L5:** `sec_bg_pair`, plus well-formed-result validation (an empty or malformed reader result gives INCONCLUSIVE).
6. **Teardown:** no dialog-capable probe (lock and delete only). The verdict is overridden if the log shows a gate refusal.
7. **Dispatch:** `gate_ledger` runs after each test group.
8. **Mock-only test hooks**, all refused in REAL mode with every other `R2D_*` variable:
   - `R2D_TEST_LOGFAIL_FROM`
   - `R2D_TEST_SUBSHELL_OP` (`1`, `bg`, `pipe`)
   - `R2D_SCAN_MAX`

## Runner and mock changes
- **Sandbox profile:** also denies exec of `/bin/ps`.
- **Process lookups:** exact-PID `/bin/ps -o … -p` (runner) or `pgrep -P <known test parents>` (mock). There is no whole-table listing (V3R-3).
- **Kernel tripwire:** counts every matching denial except those from named foreign daemons (fail-closed).
- **Mock `ps`:** call counter; late DETECTED, UNKNOWN and hang faults; mid-line stall; spoofed sentinel; missing final newline; hang PID file.
- **Mock `security`:** gate id, PS-call counter and `w` (secret read) recorded for every dialog-capable call.
- **New tests:** block T8, plus T7 updates.
