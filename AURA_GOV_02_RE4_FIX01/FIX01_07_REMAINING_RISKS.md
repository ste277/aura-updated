# FIX01-07: Remaining Risks

| ID | Risk | Sev | Status |
|---|---|---|---|
| RV4-1 | T1-6 fail-open | was P1 | **RESOLVED in code** (v2), mock- and real-tested. The real CLEAN path is not yet observed. |
| RV4-2 | argv[0] spoofing | was P2 | **MITIGATED.** argv[0]-only spoofing is defeated (kernel `ucomm` scanned). See FX-1 for the rest. |
| FX-1 | Name-only detection: renamed or copied executables, interpreters, non-token helpers, browser extensions | **P2** | **Residual, accepted only with the RC-20 wording below.** Fix proposals: executable-path or Team-ID matching; extra tokens (`updmgr`, `screensharingagent`, Splashtop `sr*`). |
| RV4-3 / FX-7 | No real clean-environment run | P2 | **OPEN.** Requires the owner to quit Claude and ChatGPT for Chrome, and the Mac's administrator to account for SuperOps RMM. This ticket did not touch them (quitting them was prohibited). |
| FX-2 | RV4-2 direction proven only in the mock | P3 | Documented; a real test would need a denylisted executable under a benign argv[0] |
| FX-3 | Timeout `kill -KILL` vs PID reuse; `sleep` from PATH | P3 | Open |
| FX-4 | Same-uid swap of the staged ps output | P3 | Open (RC-18 territory) |
| FX-5 | Single scan point | P3 | Open; attestations cover later changes |
| FX-6 | Minor test gaps | P3 | Open |
| SuperOps RMM | A signed RMM agent with root and user components is installed and running | Owner action | Identification only (FIX01-05). Provenance must be confirmed by whoever administers the Mac; T1-6 STOPs while it runs. |
| RC-20 (revised wording) | — | — | **The T1-6 scan is a best-effort tripwire against *known, unrenamed* tools. It gives no assurance against a renamed, copied or hostile process. The owner attestations remain mandatory and are the actual control.** |
| R2E/RE-4 Keychain-dependent items (RC-1…RC-24, RE-1, RE-2, RE-9…RE-15) | — | — | Unchanged; not in scope |

**Integration note.** v2 lives in `AURA_GOV_02_RE4_FIX01/`. The R2E package still pins v1 (`b9dd4d43…`). Any future authorized run must pin **v2 `4b7e4890…`** and its bootstrap hash.
