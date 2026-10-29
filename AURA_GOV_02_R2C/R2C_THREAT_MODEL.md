# R2C: Threat Model, Dedicated Locked Keychain (Phase F)

**Asset:** the rotated `aura_app_2026_11` database password (after B4: DML on all 24 app tables).
**Boundaries:**
- (1) the item ACL (`-T ''`);
- (2) the keychain lock (dedicated password);
- (3) the user's attention on dialogs;
- (4) macOS user-account separation.

| # | Threat actor | Attack or failure path | Boundary | What the evidence establishes | Residual risk | Mitigation | Severity |
|---|---|---|---|---|---|---|---|
| T1 | **Accidental user authorization** | Always Allow, or Allow on the wrong dialog | (3), then (1) is permanently open | Always Allow persists and silences reads (run 2); dialogs are indistinguishable (R2B-6) | Persistent silent access by every `security` caller (expected to be limited to unlock windows with (2); UNVERIFIED) | Fewer dialogs; never-Always-Allow rule; pre- and post-run ACL check with identity; STOP and re-rotate on OPEN | **P1** |
| T2 | **Untrusted local process (same user)** | `security find-generic-password -w` / `dump-keychain -d` | (1), (2) | Reads and dumps are denied when the dialog is denied (R2B-1…6) | It can **raise genuine dialogs** (phishing); overwrite or delete in an unlocked keychain (K4/K5); delete the file at any time | Locked at rest; validation detects substitution; treat any unexpected dialog as STOP | **P1** (phishing), P2 (availability) |
| T3 | **Trusted-executable abuse** | Once `security` is trusted, any process calls it | (1) defeated | Proven effect (run 2) | Silent disclosure while unlocked | Never trust `security`; ACL checks; locked at rest | **P1** |
| T4 | **Automation agent** | An Accessibility or computer-use agent clicks Allow or Always Allow, types the keychain password if it has seen it, or uses that password to change trust **without any dialog** (K7) | (3) defeated | Codex Computer Use had Accessibility ON during run 2; attribution unverified | Not technically preventable at the script layer | Agents OFF (preflight confirmation + process check); never display the keychain password; owner-only sessions | **P1** |
| T5 | **Compromised user session** | Keylogger captures the keychain password at unlock; code reads memory during the window | (2) defeated | Out of test scope | Full disclosure | Out of scope; endpoint security; short windows; rotate after any suspicion | **P1 (accepted out-of-scope)** |
| T6 | **Privileged local administrator** | Copies the keychain file and captures or brute-forces the password; inspects processes | (2), (4) | Not tested; **no protection claimed** | Full disclosure | Strong random keychain password; trusted admins only; organizational endpoint controls (Scrut / SuperOps agents are present) | **P1 (accepted; not defendable here)** |
| T7 | **Lost or stolen Mac** | Offline access to the disk | FileVault (not assessed), (2) | Not assessed | If FileVault is off: keychain file + offline cracking | **Verify FileVault ON** (owner); strong keychain password | **P2** (pending FileVault confirmation) |
| T8 | **Operational mistake** | Secret logged; wrong keychain targeted; Always Allow left; keychain left unlocked | — | Redaction and targeting proven in the test harnesses; lock state unverifiable | An unlocked keychain after a crash; ACL drift | Script hash logging; lock probe (D-B1); post-run checks; validated input | **P2** |
| T9 | **Spoofed or attacker-triggered dialogs** | A fake or genuine attacker-raised dialog harvests the keychain password | (3) | Real dialogs request the keychain password (property 8), which trains the habit | Password disclosure | Minimize password-entry dialogs (D-B2); enter the password only at an expected step | **P1** (aligned with T2 and RC-5) |
| T11 | **Launcher tampering (TOCTOU)** | A same-user process modifies the launcher or SQL files after the preflight hash check, or the psql and library chain | file integrity | Library pins and an embedded hash check exist (rotation plan §13); P1-B only partially mitigated | Tampered code runs with the secret | Verify the hash immediately before `zsh -f`; run from a read-only copy; pins | **P1** |
| T10 | **Backups** | Time Machine copies of the keychain file (old and new secrets) | (2) | Not assessed | Offline attack on the backups | Strong password; backup exclusion decision | P2 |

**No protection is claimed against T5 or T6.** Defending against a privileged or compromised local actor would need a different architecture (hardware-backed or external secret custody), which is outside R-2.
