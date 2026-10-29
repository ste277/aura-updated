# V3-02: Design and Threat Model

**Threat (R2C T4, the T1-6 objective).** An automation or remote-control agent acts on a Keychain dialog, or on the passphrase, during the protected window. v3 makes the process check **fail-closed, freshly re-validated before every dialog-capable operation, and free of temporary files and signals.**

## Design
| Concern | v2 | v3 |
|---|---|---|
| Capture (FX-4) | `ps` → `mktemp` file in `$TD` (`/tmp`) → read | `ps` in a **zsh coprocess** (anonymous `pipe(2)`; no filesystem path) |
| Exit status | `wait $p` | **In-band sentinel** `__R2D_PS_RC_<nonce>=<rc>`. The nonce is 64 random bits per read (builtin `sysread` of `/dev/urandom`). The sentinel must be the **exact final line** before EOF; otherwise "no exit status" gives UNKNOWN. |
| Timeout (FX-3) | `kill -0` poll, then `kill -KILL` (PID-reuse hazard) | **One deadline for the whole read** (`sysread -t`), bounded even when `ps` stalls mid-line. On timeout: close the pipe, UNKNOWN. **No signal, ever.** |
| zsh 5.9 crash | n/a | Found in v3 testing: zsh's async SIGCHLD job bookkeeping frees memory during `malloc`, giving SIGTRAP and death without traps. Mitigated with `disown %+` right after starting the coprocess (stress test: 8/8 crashes before, 0/8 after). |
| Bounds | none | `SCANMAX` = 20000 rows and 20000×512 bytes; over either limit gives UNKNOWN |
| Diagnostics (RR-2) | none | One names-free line per read: scan id, read sequence, column, rc, rows, PID 1, own row, duplicates, malformed, timeout, valid. One per result: result, hits, scanner PID, excluded self/children, reason. One per gate. **A failed write gives UNKNOWN.** |
| Fresh validation (FX-5 + V3R-4) | Single preflight scan | `t16_gate` before **every dialog-capable op**, in the harness process only. A new scan id each time; no result is reused. |
| Dialog-op choke points | — | `sec_kc` (direct), `sec_cap` (main-shell capture), `sec_i` (add-item), `sec_bg` (L5 concurrent readers). All gate first. **Every dialog-capable `$SEC` call goes through `secx`.** |
| Subshell attempts | — | `main_only` refuses (op not performed, exit 86, `R2D GATE-REFUSED` written to the log). `gate_ledger` stops the run at the next gate and at the end of each test group. |
| Teardown | lock, probe, delete | lock, delete (no dialog-capable probe) |

## Dialog-capable inventory (V3R-4)
| Subcommand | Dialog-capable? | Gated |
|---|---|---|
| `create-keychain` | yes (passphrase prompt) | ✓ |
| `unlock-keychain` | yes | ✓ |
| `set-keychain-settings` | may require unlock | ✓ |
| `show-keychain-info` | conservatively yes | ✓ |
| `dump-keychain` (all modes) | yes (unlock or item access) | ✓ |
| `find-generic-password` (with or without `-w`) | yes | ✓ |
| `delete-generic-password` | yes | ✓ |
| `add-generic-password` (via `security -i`) | yes | ✓ |
| `lock-keychain` | no authentication | not gated (teardown, watchdog) |
| `delete-keychain` | no authentication (assumption) | not gated (teardown) |
| `list-keychains -d`, `default-keychain -d` | read-only, no dialog | not gated |

## Unchanged
- DENYT (SuperOps stays DETECTED).
- The preflight stop messages and verdict text.
- Every other T1 control.
- REAL mode refuses all `R2D_*` variables, including the new mock-only hooks.
- No managed-device mode.
