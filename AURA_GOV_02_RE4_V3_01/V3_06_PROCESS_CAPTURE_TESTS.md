# V3-06: Process Capture (FX-4 / V3R-2 / RR-7)

**Mechanism.**
- A zsh coprocess (anonymous `pipe(2)`; no filesystem path), read with `sysread`. **No temp file**: the static check bans `mktemp`, `r2d-scan`, `TMPDIR` and `$TD` in the block, and the FINAL audit finds no `r2d-scan.*` file.
- Exit status arrives in-band as `__R2D_PS_RC_<16-hex nonce>=<rc>`. The nonce is new for each read (64 bits from `/dev/urandom`, builtins only, 0–255 guard).
- **The output must end with a newline and the sentinel must be the exact final line**; otherwise there is no status, and the result is UNKNOWN.

| Scenario | Fault | Result (all PASS) |
|---|---|---|
| T8_spoof_sentinel | A name containing a newline followed by a fake fixed sentinel and a fake guessed-nonce sentinel, then a TeamViewer row | Both fakes are malformed rows, so UNKNOWN; later rows are **not** dropped (`rows=4`); never CLEAN |
| T8_no_trailing_newline | Output without a final newline | Sentinel not on its own line, so `no exit status`, UNKNOWN |
| T7_ps_rc_* / output_then_fail | Non-zero `ps` status, with or without rows | UNKNOWN |
| T7_ps_empty*, T7_ps_partial*, T7_ps_malformed, T7_ps_blank_line, T7_ps_missing_column, T7_ps_bad_pid/ppid, T7_ps_duplicate_pid | Structural faults | UNKNOWN |
| T7_ps_no_launchd, T7_ps_own_row_missing | PID 1 or scanner PID missing | UNKNOWN |
| T8_nonce_samples | 500 harness nonces | 0 malformed, 0 repeated |

**Invalid exit marker / marker mismatch / not on final line:** covered by the spoofed sentinels (fixed form and guessed nonce) and the missing final newline.

**Limitation:** a synthetic `ps` cannot emit a sentinel carrying the *real* nonce in a non-final position, since it doesn't know the nonce. That path is covered by code inspection: the sentinel is only accepted as the last line.
