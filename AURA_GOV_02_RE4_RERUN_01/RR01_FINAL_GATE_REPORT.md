# AURA-GOV-02-RE-4-RERUN-01 — Final Gate Report

## STOP-leg verdict: **CONDITIONAL PASS**
On the real Mac, the pinned v2 T1-6 code returned **DETECTED** and **stopped before any protected operation**. There was no Keychain access and no interference with any other process.

It is conditional only because the real-table structural validation is shown by code inference rather than by logged evidence (RR-2, P3). Repeating the run to log it was not authorized.

| §9 criterion | Result |
|---|---|
| All baseline hashes verify | ✓ FIX01 22/22 (`fc18957f…`), v2 `4b7e4890…`, R2E 120/120, RE-4 11/11 |
| Approved v2 harness used | ✓ Exact extracted block, hash `730c09f0…` |
| Real table passes structural validation | ✓ by code inference (RR-2) |
| DETECTED returned | ✓ |
| Stops before protected operations | ✓ exit 2; no tripwire; no sentinel |
| No real Keychain access | ✓ |
| No unrelated-process interference | ✓ |
| Independent AI review | ✓ CONDITIONAL PASS, no P0/P1 |
| Evidence manifest verifies | ✓ `SHA256SUMS` |

**Detected (both `comm` and `ucomm` matched for each):** ChatGPT for Chrome, Claude, Claude Helper, Claude Helper (Renderer), claude, superops (SuperOps RMM).

**Outstanding, unchanged:**
| ID | Sev | Limitation |
|---|---|---|
| FX-1 | P2 | Name-only detection |
| FX-2 | P3 | Real spoof direction untested |
| FX-3 | P3 | Timeout PID reuse |
| FX-4 | P3 | `/tmp` staging swap |
| FX-5 | P3 | Single scan point |
| FX-6 | P3 | Test gaps |
| FX-7 | P2 | No real CLEAN |

## Recommendation for the clean-host gate
It needs separate authorization and an owner-run session:
- Quit Claude, Codex and ChatGPT (including the Chrome extension).
- Have the Mac's administrator account for SuperOps RMM.
- Run the pinned v2 scan with `NROWS`/`PSRC` logged on every outcome (this also closes RR-2).
- Expect a real CLEAN with ≥ 20 rows and a redacted pid/ppid/name table.

The clean-host leg, all Keychain-dependent operations, R-1, B4, B5, B6 and Tier 2 remain on **HOLD**.
