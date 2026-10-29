# AURA-GOV-02-RE-4-CLEAN-01 — Final Report

## Assessment verdict: **CONDITIONAL PASS**
The assessment is complete. Essential **authorization facts are unknown**: who governs the SuperOps tenant, whether a VM or a second host is allowed, and whether scanner CLEAN plus attestations is the full requirement. There is no P0/P1. The independent review concurs, and its corrections CR-1 to CR-10 are applied.

**Gate classification: CONDITIONAL.** Option B is potentially acceptable once authorization and v3 prerequisites are met. Option A is not currently feasible.

| Question | Answer |
|---|---|
| Baseline | ✓ FIX01 22/22 `fc18957f…`; R2E 120/120; RE-4 11/11; RERUN-01 12/12 `a8adb876…`; v2 `4b7e4890…` |
| Real CLEAN on the current Mac? | **Not feasible without administrator action.** Why: a SuperOps RMM root daemon (KeepAlive) runs, `superops` is a written refusal condition (R2D-02 T1-6(b)), and the Mac is MDM-enrolled (User Approved, SuperOps server). The user stopping SuperOps or removing it from the denylist is unacceptable. An administrator unenrolling or removing it (A′) is the administrator's decision and is not proposed here. |
| Isolated environment preferable? | **Yes, as the route to real CLEAN code-path evidence.** It must be explicitly authorized, use v3 instrumentation, be owner-run with no AI tools on the host, and stop at the first attestation. It proves the scanner, **not** this Mac. |
| FX-1 … FX-7 | All **open**: FX-1 and FX-7 P2; FX-2…FX-6 P3. Designs are proposed in CLEAN01-04; nothing is resolved. |
| RR-2 / RR-6 / RR-7 | Open (P3). RR-2: v3 per-read count/status logging on every outcome. RR-6: no-signal timeout, then rely on the mock. RR-7: close by design (file-less read or private directory). |
| Recommended option | **C now** (extend the synthetic CLEAN-path tests within a v3 ticket) **plus D** (defer the real CLEAN). **B** is the next real-host step **only if** the owner (and administrator, where applicable) authorize it. **A: no.** |

## Outstanding authorization requirements
- **Owner:**
  - SuperOps stance (disqualifying, recommended; or a formal exception, not recommended);
  - the requirement scope (UNRESOLVED);
  - authorize a v3 code ticket;
  - choose the host for a real CLEAN;
  - decide where any Tier 2 run would happen;
  - name the security owner.
- **Administrator** (only if the route touches this Mac or a company device; the owner obtains this, the workstream does not contact the administrator):
  - VM or second-device policy;
  - an approved test environment;
  - RMM remote-session capability.
- **For any future live run:** a separate execution ticket, plus R2D-08 §B authorization and attestations.

## Exact next owner decision
**Confirm that an MDM/RMM-enrolled host is disqualified for the Keychain prototype under R2D-02 T1-6(b), and decide whether to authorize the v3 code-and-mock ticket** (RR-2, FX-3 no-signal timeout, FX-4 file-less read, FX-5 re-scans). Choosing a real-host Option B comes afterwards.

**Ticket conduct:**
- **Not run:** a process scan, the clean leg, any Keychain operation, any `security` call.
- **Not touched:** any process signal; SuperOps, Claude, Codex or ChatGPT; device management; any harness or earlier evidence.
- **Not done:** contacting anyone; commit, merge, push or deploy.

The clean-host leg, all Keychain-dependent operations, R-1, B4, B5, B6 and Tier 2 remain **HOLD**.
