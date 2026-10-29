# V3-09: Residual Findings

## FX / RR / V3R items
| Item | Status | Basis |
|---|---|---|
| FX-3 timeout / PID reuse | **CLOSED** | No signal anywhere on the scan or gate path; whole-read deadline incl. mid-line stall (V3-05) |
| FX-4 temp-file substitution | **CLOSED** | Anonymous pipe; no scan file (V3-06) |
| FX-5 single scan | **CLOSED (synthetic)** | A fresh gate before every dialog-capable op (V3-07) |
| RR-2 structural diagnostics | **CLOSED** | Per read, per result and per gate; fail-closed (V3-04) |
| RR-6 timeout evidence | **PARTIALLY ADDRESSED** | Mock evidence only, including the mid-line stall; no real-host timeout run (not authorized) |
| RR-7 `/tmp` risk | **CLOSED** | By design (no file) |
| FX-1 name-based detection | **OPEN** (P2) | Unchanged; renamed or copied executables, non-token helpers and interpreter-run automation are not detected. Review-only. |
| FX-2 spoof coverage | **OPEN** (P3) | Mock-only for the real direction |
| FX-6 test gaps | **PARTIALLY ADDRESSED** | Newline-in-name, missing-newline, logging-failure and bypass forms are now tested. Remaining: mktemp-failure is moot; the L5 check is weaker than its label (FR-6). |
| FX-7 real CLEAN | **OPEN** | Not authorized. Must be done on **v3** (the T1-6 block changed). |
| V3R-1, 2, 3, 6, 7 | **CLOSED** | Re-reviewed |
| V3R-4 dialog gating | **CLOSED** | All 8 op types; bypass forms refused and stopped |

## New residuals (P3)
| ID | Residual |
|---|---|
| FR-5' | A gate refusal now **replaces** an earlier verdict, such as a security FAIL, in the final VERDICT line. The FAIL remains in the log's STOP line. Consider appending instead. |
| FR-6' | The L5 adjacency check proves "two secret reads on adjacent gates", not "exactly two" or "no scan during reads". The no-scan property comes from the code order (statically checked). |
| FR-9 | A silent `disown` failure. Harmless, because an unmatched job means it was already reaped. |
| zsh 5.9 | The async-SIGCHLD crash is a shell bug, mitigated rather than eliminated. Other async children (watchdog, L5 readers) are arranged so no regex-heavy scan runs while they are alive. A future zsh/macOS change could reopen it. |
| Orphan lifetime | After a timeout, the abandoned `ps` is not time-bounded (it ends on its next write). |
| `delete-keychain` non-dialog | An assumption; to be confirmed in any authorized real run. |
| Teardown probe removed | Teardown no longer records post-lock state. Deletion is still verified by `-e $KC`. |
