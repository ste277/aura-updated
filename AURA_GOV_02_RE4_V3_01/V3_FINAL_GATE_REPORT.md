# AURA-GOV-02-RE-4-V3-01 — Final Gate Report

## Verdict: **CONDITIONAL PASS**
The core implementation and synthetic validation pass. Documented, non-critical residuals remain: FX-1, FX-7 (not authorized), RR-6, and the P3 items FR-5', FR-6', FR-9 and the mitigated zsh 5.9 crash. **No unresolved P0/P1.**

| §10 PASS criterion | Result |
|---|---|
| Baseline integrity verified | ✓ 8 packages (9/9 … 120/120); v2 `4b7e4890…` unchanged |
| Seven T7/T8 failures resolved | ✓ Root causes: nonce pipeline; zsh 5.9 SIGCHLD/malloc crash; stale expectations |
| T7/T8 pass | ✓ T7 251/0, T8 198/0 (final run) |
| Full synthetic suite passes | ✓ **1092/0**, 148 scenarios, runner exit 0 |
| V3R-4 implemented and tested | ✓ 8 op types; 54/54 G1 calls freshly gated; bypass forms refused and stopped |
| No ungated reachable dialog-capable op | ✓ Static choke-point checks plus runtime gate-id evidence |
| SuperOps refusal preserved | ✓ DETECTED; DENYT unchanged; no managed-mode code |
| No live scanning or Keychain access | ✓ Sandbox denies `/bin/ps` and `security`; kernel tripwire 0 hits. One host-wide listing was written into a command by mistake and **stopped before it executed** (V3-08). |
| Independent review complete; no P0/P1 | ✓ Two fresh reviews plus a targeted re-review |
| Evidence package and manifest verified | ✓ `SHA256SUMS` |

**Final v3 candidate:** `r2d_prototype.zsh` = `5197b041e6652de4f1593d24513b65ac1e338d2a964b84f8273801c73bef6681`

## Live-execution restrictions (unchanged)
- **On HOLD:** live process scanning, real Keychain operations, MANAGED-AUTHORIZED, R-1, B4, B5, B6 and Tier 2.
- v3 is a **candidate**. Any future real run must pin **this** hash and its bootstrap hash, and needs separate authorization under R2D-08 §B.

## Next authorization gate
The owner (and, per REV-01, the security owner) decides whether to **accept v3 `5197b041…` as the pinned harness**. After that, separately, whether to authorize a v3 real-host STOP-leg revalidation. The T1-6 block and capture changed, so the RERUN-01 STOP-leg evidence does not carry over to v3.
