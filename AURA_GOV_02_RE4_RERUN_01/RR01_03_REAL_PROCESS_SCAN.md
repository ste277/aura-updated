# RR01-03: Real Process Scan

**Command (once):** `/bin/zsh -f probes/rr01_stop_probe.zsh ../AURA_GOV_02_RE4_FIX01/r2d_prototype.zsh 4b7e48900fb09b2b9bddda6e2306f284233178e59b5ebc2fd247fd32b2510d95 evidence <scratchpad>/rr01_tmp_1476b58d`

**When and where:** 2026-11-14T10:58:45Z, macOS 14.6 (23G80), uid 501, no administrator rights. **Probe exit: 2.**

- Scan process pid 68594, parent 68569.
- Only naturally running processes: no dummy, no application started.
- **SCAN = DETECTED.** Both reads (`ucomm`, then `comm`) ran against real `/bin/ps -ww -axo pid=,ppid=,<col>=`.
- **Structural validation: passed by code inference (reviewer RR-2, P3 evidence gap).**
  - `SCAN=DETECTED` can only be set (harness line 218) after both `ps_parse` calls return 0 (207–208).
  - `ps_parse` returns 0 only with: rc 0, non-empty output, every row well-formed, no duplicate PID, ≥ 20 rows, PID 1 present, own PID present (193–202).
  - The DETECTED path does not log the row count or exit codes. The probe's own snapshot read 473 rows before and after; that was a separate `ps` call.
  - A run that logs `NROWS`/`PSRC` on DETECTED would turn this into direct evidence. It was not repeated, because this ticket authorizes one run.
- **Timeout:** did not fire. A timeout gives `PSRC=124` and therefore UNKNOWN, which cannot produce DETECTED.
