# RE4-07: Remaining Risks (after RE-4)

| ID | Risk | Sev | Status |
|---|---|---|---|
| RE-4 (R2E) | Real T1-6 scan never run | was P1 | **Partly closed.** Real parsing and detection were demonstrated (STOP leg). Still open: the clean leg, the fail-open defect (RV4-1) and argv[0] evasion (RV4-2). |
| RE-4b (R2E) | Real `ps` identity format for the watchdog | was P2 | **Closed for `is_wd`.** Exact PID, argv tail and parent all work against real `/bin/ps`. The observer harness-identity check is not exercised (RV4-6, fails closed). |
| RE-6 (R2E) | `ps` truncation | P2 | No truncation to a pipe was observed; `-ww` is used. Tty behaviour untested (moot). |
| RV4-1 | T1-6 fail-open on a `ps` failure | **P1** | **OPEN.** Source fix proposed; a new authorized implementation ticket is required. |
| RV4-2 | argv[0] rename evades the name scan | P2 | OPEN. Strengthens RC-20: the attestation is the real control. |
| RV4-3 | No clean leg; `superops` and `ChatGPT for Chrome` present | P2 | OPEN. The owner should identify or quit them, then run a clean leg. |
| RV4-4 / RV4-5 / RV4-8 | Probe design and provenance gaps | P2 / P3 | Disclosed. Harden the probe before reuse. |
| RV4-7 | Identity-to-signal race; teardown `pkill -P` unchecked | P3 | Open; fix proposed |
| RC-1…RC-24, RE-1, RE-2, RE-9…RE-15 | Keychain-dependent items | P1/P2 | **Unchanged.** Not addressed by RE-4 (no Keychain test). |

**Gates (unchanged):** real-Keychain testing, prototype execution, Tier 2, R-2, R-1, B4, B5, B6 and production approval are all on **HOLD**. The production merge freeze is active.
