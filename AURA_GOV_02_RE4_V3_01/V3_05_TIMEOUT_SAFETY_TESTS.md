# V3-05: Timeout Safety (FX-3 / V3R-1)

**Design.** One deadline (`SCANTO`, 10 s in REAL mode) bounds the whole read, using `sysread -t` on the coprocess pipe. On timeout the pipe is closed and the result is UNKNOWN.
- **There is no `kill`, `pkill`, `killall` or PID-based signal in the scanner or gate code**, statically checked by `T7_static_no_pipeline`.
- There is no reliance on the job table to justify signalling.

| Scenario | Fault | Result (all PASS) |
|---|---|---|
| T7_ps_timeout | `ps` hangs before any output (2 s bound) | UNKNOWN `timeout after 2s (no signal sent)`; run < 20 s; diagnostics `rc=none timeout=yes`; **the hung mock is still alive right after the harness exits (not signalled)** and then ends by itself |
| T8_midline_stall | `ps` writes a **partial row with no newline**, then hangs | Same: the whole-read deadline fires; no signal; ends by itself (this was the V3R-1 regression case) |
| T8_gate_timeout | Hang begins at the unlock gate | Unlock blocked (UNKNOWN), with no signal |

**Bounding.**
- **Harness wall time** is bounded by `SCANTO` per read.
- An abandoned `ps` and its coprocess shell are left to finish. At most one is abandoned per run, because an UNKNOWN stops the run. **Its own lifetime is not bounded**: it ends on its next write (EPIPE) or when `ps` returns.

**zsh 5.9 crash (found and fixed in this ticket).**
- **Symptom:** an intermittent silent harness death (the earlier `T7_ps_own_row_missing` failure, among the 7 failures).
- **Cause:** crash report `zsh-2026-11-14-180843.ips` shows SIGTRAP in `zhandler → wait_for_processes → update_job → freejob → free`, interrupting `malloc` inside `tre_compile`. zsh's async SIGCHLD job bookkeeping corrupts the heap lock.
- **Reproduction** (scratchpad stress test, 400 coprocess reads plus regex parsing per run):

  | Variant | Runs crashed |
  |---|---|
  | No mitigation | 8/8 |
  | `wait` | 0/8 |
  | `disown` **right after start** | 0/8 |
  | `disown` after the fact | 8/8 |

- **Fix:**
  - disown the coprocess job, matched by its own PID through `$jobstates`;
  - L5 runs both gates *before* launching its readers, so no scan runs while a reader job is alive.
- **Result:** no zsh crash report was produced during the final 1092-check run. All crash reports on the host are from before it, or from the deliberate stress runs.
