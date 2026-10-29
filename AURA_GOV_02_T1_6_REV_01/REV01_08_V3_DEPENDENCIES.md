# REV01-08: V3 Dependencies

**V3-01 status:** no artifacts exist in the workspace (REV01-01). It is treated as **not delivered**.

| Need | Belongs to | Notes |
|---|---|---|
| Per-read structural logging (RR-2) | **V3-01** | Prerequisite for any mode, including CLEAN |
| No-signal timeout (FX-3) | **V3-01** | **Hard prerequisite** for managed mode (amendment §7) |
| File-less `ps` read (FX-4) | **V3-01** | — |
| Fresh scan before every protected operation (FX-5) | **V3-01** | Required by amendment §8 |
| Synthetic CLEAN/DETECTED/UNKNOWN tests | **V3-01** | — |
| `MANAGED-AUTHORIZED` outcome and identity binding (identity: `user=root` for the daemon, `lsof txt` plus codesign Team ID for the tray agent; LaunchDaemon and LaunchAgent `ProgramArguments[0]` checks; single tray instance; administrator-signed agent inventory; `comm`/`ppid`/`ucomm` as consistency checks only) | **New, separate ticket**, only after the amendment is approved | **Must not** be folded into V3-01 |
| Explicit activation (`--managed-device=<hash>` + approval-record file + tty confirmation) | Same separate ticket | — |
| Re-scan PID-set consistency for allowed agents | Same separate ticket | Builds on the V3-01 re-scans |
| Mock tests: spoofed `superops` name; **user process with ppid=1 and argv[0] set to the real path**; **copied binary named `superops`**; wrong user; tray agent without the LaunchAgent or with two instances; bad signature or Team ID; **un-inventoried agent present**; expired, out-of-window or mismatched record; record with bad permissions; activation absent; **managed mode active but expected agents absent** (must give UNKNOWN, never CLEAN); other denylisted hit present → DETECTED/UNKNOWN | Same separate ticket | **Never CLEAN while managed mode is active** |

**Sequence:**
1. V3-01 (approved, implemented, reviewed, re-pinned).
2. Amendment decision (REV01-06 §12).
3. If approved, a managed-mode implementation ticket.
4. Mock suite plus independent review.
5. Only then any live gate, separately authorized.

**No code change is made by this ticket.**
