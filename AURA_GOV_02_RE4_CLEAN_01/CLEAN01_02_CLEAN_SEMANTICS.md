# CLEAN01-02: What CLEAN Proves

## Exact v2 semantics (harness v2 lines 183–224)
**`SCAN=CLEAN`** (line 218) is set only when **all** of the following hold:
1. Both bounded reads, `/bin/ps -ww -axo pid=,ppid=,ucomm=` and then `…comm=`, exit 0 within 10 s each (186–190).
2. Each read is non-empty, and every row matches `^ *<pid> +<ppid> +<name>$` with no duplicate PID (193–198).
3. Each read has ≥ 20 rows, a PID-1 row and the harness's own row (199–201).
4. After excluding the harness and its direct children (211–213: where both reads agree the parent is the harness, or the PID appears in only one read with the harness as parent), **no** kernel name (`ucomm`, ≤16 chars) and **no** argv[0] basename (`comm`) starts with any token in `DENYT` (203, 214–215).

## Two different claims
| | Scanner CLEAN | Environment assurance |
|---|---|---|
| Meaning | In two validated point-in-time snapshots, no process **name** began with a configured token | Independent evidence that the host meets the security and authorization requirements (no unauthorized automation, remote access or monitoring able to act on the session) |
| Established by | v2 T1-6 | Nothing in the harness. It would need owner attestation, device-management facts and administrator statements. |
| Does **not** establish | That there is no monitoring or endpoint management; no renamed or copied executables (FX-1); no non-token helpers or interpreter-run automation (FX-1); no browser-extension agents; no process started after the scan (FX-5); no in-kernel or root-level observer | — |

**Scanner CLEAN is not a trusted or unmonitored host.**

## What the requirements demand
- **R2D-02 T1-6** requires three things together:
  - **(a)** owner attestations: every Accessibility toggle OFF, and Sharing (Screen Sharing / Remote Management / Remote Login) OFF;
  - **(b)** the harness process check: *"Refuse if any of these run: … SuperOps …"*;
  - **(c)** the owner confirms no remote-support session is active.
- **R2D-08 §B** repeats (a) and (c) as execution preconditions.
- **R2D-04 RC-20** classes the control as *"procedural … no technical enforcement"*.
- **R2D-03** (line 56) states the residual: *"What no test can establish: protection against a compromised session or an admin … or against UI automation that is present but undetected."*
- **RC-18** accepts the compromised-session/admin risk.

**So the written requirement is scanner CLEAN plus attestations.** It does not demand broader environment assurance.

**UNRESOLVED (requirement ambiguity).** The documents do not say whether RC-18's acceptance of the "admin" risk was meant to cover a host **actively enrolled in an MDM/RMM platform** whose operator can act remotely as root (see CLEAN01-03). R2D-02(b) lists SuperOps as disqualifying, which suggests the designers did **not** intend to accept it. This has to be decided by the owner and the security owner, not inferred.
