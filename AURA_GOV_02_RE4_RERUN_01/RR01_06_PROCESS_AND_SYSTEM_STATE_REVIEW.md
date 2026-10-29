# RR01-06: Process and System-State Review

| Item | Evidence | Result |
|---|---|---|
| Signals | Code paths that ran hold only `kill -0` and a timeout-only `kill -KILL` aimed at the probe's own ps child. The timeout did not fire. No other signal was sent. | ✓ No unrelated process signalled |
| Denylisted processes before and after | `evidence/rr01_before_denylisted_names.txt` and `rr01_after_…`: 19 rows each (pid + 16-char kernel name only), **byte-identical**. That includes SuperOps PIDs 510 and 16883, and the Claude and ChatGPT for Chrome processes. | ✓ Unchanged |
| Total process rows | 473 before, 473 after | Consistent |
| Applications quit, started or renamed | None | ✓ |
| SuperOps RMM | Observed only; not stopped, disabled, renamed or bypassed | ✓ |
| Files | Created only `AURA_GOV_02_RE4_RERUN_01/` content. A private temp dir (mode 700) was created and removed by exact path. No scan temp file was left. | ✓ |
| Device management, settings, launchd | Untouched | ✓ |
| Harness and earlier evidence | v2, R2E, RE-4 and FIX01 unmodified (manifests re-verified after the run) | ✓ |

**Limitation (reviewer RR-8):** identical snapshots are consistent with no interference but do not prove it. The real argument is that no signal exists in the code that ran.

**Redaction:** only process names and PIDs of denylisted processes are recorded. No command lines, arguments, credentials or full inventory.
