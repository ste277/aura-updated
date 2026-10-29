# RR01-07: Independent AI Review

**Reviewer:** a fresh-context agent, static and read-only (`shasum`, `awk`, `grep`, `diff` only; no probe, `ps`, signal or `security`).

**What it recomputed itself:**
- the harness hash (`4b7e4890…`);
- the FIX01 manifest hash (`fc18957f…`);
- the extracted-block hash (`730c09f0…`);
- the probe hash (`9a6b809f…`).

All match.

| ID | Sev | Finding | Status |
|---|---|---|---|
| RR-1 | P3 | Probe and evidence were not hash-pinned (self-attesting log) | **Closed** by this package's `SHA256SUMS` |
| RR-2 | P3 | Structural validation shown by code inference, not by logged row count or exit codes on DETECTED | **Open** (evidence gap). A rerun logging `NROWS`/`PSRC` would close it; not authorized here. |
| RR-3 | P3 | The probe stands in for the real entry point (subshell, private TD, stubs, no answers fd). None changes the STOP result; the real REAL-mode preflight stops even earlier. | Accepted |
| RR-4 | info | DETECTED and UNKNOWN cannot continue; the log confirms exit 2, no tripwire, no sentinel | Verified |
| RR-5 | info | No route to Keychain on the STOP path, including the EXIT-trap teardown | Verified |
| RR-6 | P3 (FX-3) | Timeout path not exercised; PID-reuse risk unchanged | Open |
| RR-7 | P3 (FX-4) | The private 0700 dir says nothing about the real `/tmp` staging risk | Open; not claimed as closed |
| RR-8 | info | No signals in the code paths that ran; before/after snapshots identical | Verified |
| RR-9 | P3 | Redaction acceptable (names and PIDs only) | Accepted |
| RR-10 | P2 (FX-1/FX-7) | Detections come from naturally running apps. This proves the STOP leg only: nothing about CLEAN, or about renamed or copied binaries. | Open |

**FX-1 … FX-7: all still unresolved.** This ticket changes none of them.

**Reviewer recommendation: CONDITIONAL PASS.** There is no P0/P1. The STOP leg is verified, and the structural-validation evidence is indirect (RR-2).
