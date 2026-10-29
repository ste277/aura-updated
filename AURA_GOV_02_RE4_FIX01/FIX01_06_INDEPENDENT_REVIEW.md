# FIX01-06: Independent Security Review

**Reviewer:** a fresh-context agent, static and read-only (cat, grep, diff, shasum, sed only). It ran no harness, runner, probe, `ps`, `pgrep`, signal or `security`.

**What it verified itself:**
- The v2 hashes under test.
- That the R2E original is unchanged.
- That v2 differs from the original only at lines 38–39, 112 and 177–224.

## Fail-closed analysis: no path ends in CLEAN or lets the run continue
- `SCAN=UNKNOWN` is set first, and CLEAN is set only on the last line, after both validated parses. The case statement's default branch is STOP.
- zsh semantics confirmed:
  - dynamic scoping of the `PT`/`NT` locals;
  - quoted associative-array copies;
  - `"${(@f)…}"` keeps blank rows in the middle;
  - `wait $p` keeps the status of a job that was already reaped; an unknown PID returns 127, which is UNKNOWN.
- mktemp failure, a failed redirect and a missing file all lead to UNKNOWN.
- The real-host checks R-3a/R-3b confirm the error codes.

## Findings
| ID | Sev | Finding | Disposition |
|---|---|---|---|
| FX-1 | **P2** | Name-based identity can be evaded without touching argv[0]: a copied, renamed or hardlinked executable; interpreter-run automation; non-token vendor helpers (`updmgr`, `ScreensharingAgent`, Splashtop `SR*`); browser-extension agents; symlink behaviour unverified | **Residual, documented** (FIX01-04, FIX01-07). Proposed: match on executable path or Team ID (e.g. via `lsof`/proc_pidpath), extend the tokens, and state in RC-20 that the scan is a best-effort tripwire |
| FX-2 | P3 | The real test covers only the reverse spoof direction; the RV4-2 direction is mock-only | Documented (FIX01-05). The suggested probe copies a platform binary, which macOS SIGKILLed in RE-4, so it was not run |
| FX-3 | P3 | Timeout path: if the ps PID is reaped and reused within the poll window, `kill -KILL` could hit an unrelated process; `sleep 0.05` comes from PATH and forks | Open. Proposed: poll `$jobstates` and use `zselect` |
| FX-4 | P3 | ps output staged in `$TD` (`/tmp` under `env -i`) could be swapped by a same-uid process | Open; mostly outside the threat model (RC-18). Proposed: read through a pipe/coproc or a 0700 directory |
| FX-5 | P3 | Single scan; a prohibited app started later is covered only by the attestations | Open. Proposed: rescan before each keychain step |
| FX-6 | P3 | Test gaps: weak de-dup assertion; no mktemp-failure, CR or newline-in-name case; the survey's "387 differ" compares padded values | Open; documented |
| FX-7 | P2 (residual) | RV4-3: no real CLEAN observed; the SCANMIN floor and two-read consistency are untried on a clean host | **Open** (needs the owner's clean-leg run) |

The reviewer judged that **no T7 check passes vacuously**, because the clean fixture proves UNKNOWN is not universal. The two changed T1 expectations are stricter, not weaker.

## Status
- **RV4-1 (P1 fail-open): RESOLVED in code.** Mock: 16 UNKNOWN scenarios plus the timeout (888/0). Real: R-3a to R-3e (22/0). The real CLEAN path still awaits RV4-3.
- **RV4-2 (P2 argv[0] spoof): MITIGATED.**
  - argv[0]-only spoofing is defeated: real R-2c shows `ucomm` ignores argv[0], and mock T7_comm_spoofed_benign detects the spoof.
  - Executable renaming and non-token helpers remain (FX-1).

**Reviewer recommendation: CONDITIONAL PASS.** Accept the FIX01 code. Before RE-4 can close:
1. The RV4-3 clean-host leg.
2. Real evidence for the FX-2 direction, or an accepted rationale for its absence.
3. RC-20 wording on the FX-1 limitations.
