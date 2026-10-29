# REV01-04: Managed-Device Threat Model

**Basis.** Facts come from existing evidence:
- FIX01 survey: SuperOps root daemon (KeepAlive), user tray agent, update managers; Developer ID Superops Inc. 4SPX8Y4YUX.
- CLEAN01 evidence: MDM-enrolled, User Approved, SuperOps MDM server.
- R2C/R2D documents.

**Nothing here assumes SuperOps reads Keychain contents or records credentials.** Where its capabilities are not evidenced, they are marked **UNKNOWN**.

| Risk | Facts | Unknown | Mitigation: technical (T) or human/policy (H) |
|---|---|---|---|
| **Endpoint monitoring visibility** | RMM agents with root and user components are running | What telemetry is collected (process lists, logs, screenshots) | H: administrator statement of the collection scope. T: the harness never displays or logs secrets (R2E mock evidence: synthetic values "never logged", R2E-04 line 12; no-secret checks in the R2E/FIX01 suites; R2D-05 custody rules). Keychain passphrases are typed into a tty, not shown. |
| **MDM capabilities** | User-Approved MDM enrollment | Configured profiles and commands (for example remote lock or wipe, profile push) | H: administrator statement. T: none from the user side. |
| **Local privileged processes** | A root-owned RMM daemon exists | Its scripting or remote-execution features | Already **accepted** as R2C T6 (privileged admin, "no protection claimed"). Not technically mitigable. |
| **Credential/passphrase exposure** | Throwaway passphrase, typed in a tty with Secure Keyboard Entry (R2D-05/08) | Whether the RMM supports keystroke or screen capture | T: throwaway-only passphrase, never reused (R2D-05). H: no remote session or capture during the window (administrator plus owner attestation). |
| **Keychain access boundaries** | The prototype uses a **throwaway** keychain with **synthetic** values only | — | T: the existing T1-1/T1-2/T1-8 controls. The residual impact of exposure is the synthetic values only. |
| **Logging and diagnostic collection** | The harness writes logs under `~/aura-r2b-evidence` with secrets not logged | Whether the RMM uploads user files or logs | T: secrets are not logged (R2E-04 line 12; suite no-secret checks). H: collection-scope statement. |
| **Remote administrative capability** (the central T4 issue) | — | **UNKNOWN**: remote screen view or control, remote shell or scripts, session notification to the user | H only: administrator attestation that no remote session or script will run during the window, and how a session would show up locally. Owner attestation T1-6(c). **Cannot be verified technically by the harness.** |
| **Process-name detection limits** (FX-1) | Name-only matching; allowing a name would let a *spoofed* process named `superops` through | — | T: any allowance must be **identity-bound**, not name-bound (REV01-06 §3). |
| **TOCTOU** (FX-5) | A single scan, then minutes of operations | — | T: re-scan before every protected operation (V3-01 scope). |
| **Treating managed as clean** | A scanner that allows the agent would no longer say "nothing denylisted runs" | — | T: a **distinct outcome** (`MANAGED-AUTHORIZED`), never `CLEAN`. H: an explicit risk-acceptance record. |

**Conclusion.** No **security-equivalence** claim to an unmanaged CLEAN host is supported. A managed-device mode can **bound** the risk technically: identity-bound allowance, no other hits, fail-closed UNKNOWN, re-scans. The remote-operator capability (T4-like) and privileged presence (T6) remain, and need **human assurance and formal risk acceptance**.
