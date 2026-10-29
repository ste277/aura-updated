# R2C: Consolidated Risk Register

Earlier findings are preserved (R2B RK-1…14; rotation plan R2 items). Every one is mapped in the table below. "Blocks R-2" refers to advancing the R-2 Keychain design gate.

## R2B RK → R2C mapping

| R2B ID | Status in R2C |
|---|---|
| RK-1 | → RC-2 (open) |
| RK-2 | → RC-1 (open) |
| RK-3 bulk-dump bypass | **Closed / refuted for the unlocked, all-deny case** by R2B-4; residual (partial allow, `rc=0`, 4 dialogs) → RC-15 |
| RK-4 | → RC-3 (open) |
| RK-5 | → RC-8 (open, mitigated by design direction) |
| RK-6 unlocked by default | → RC-4 / RC-6 (open) |
| RK-7 automation | → **RC-20** (own row; open, procedural, ongoing) |
| RK-8 runs outside Terminal | carried: mitigated (procedural) → RC-21 |
| RK-9 global keychain state | carried: mitigated (harness guards, verified in R2B/R2B-6) → RC-22 |
| RK-10 server-side plaintext | → RC-19 |
| RK-11 | → RC-9 |
| RK-12 | → RC-11 (raised to P1, aligned with T9) |
| RK-13 Keychain Access.app | → **RC-23** (open, procedural) |
| RK-14 | → RC-14 |
| Rotation plan §13 residual #3 (launcher TOCTOU; P1-B partial) | → **RC-24** |


| ID | Sev | Finding | Evidence | Root cause / hypothesis | Impact | Mitigation | Blocks R-2 | More testing |
|---|---|---|---|---|---|---|---|---|
| RC-1 (=RK-2/T3) | **P1** | Always Allow persistently trusts `/usr/bin/security`, so silent reads by any same-user caller | run 2 R2-5b `(1)`, silent reads | macOS ACL semantics | Credential disclosure | Pre/post ACL check with identity; locked keychain; never Always Allow | **Yes** | Yes: behaviour of a trusted app while the keychain is **locked** |
| RC-2 (=RK-1/T1) | **P1** | Dialog misattribution or automated approval occurred in run 2 (unexplained actor; historical event) | reconciliation | human error or automation (unverified) | as RC-1 | fewer dialogs; ACL checks | **Yes** | No (historical; can't be resolved retrospectively) |
| RC-3 (=RK-4) | **P1** | Concurrent dialogs are indistinguishable, so an attacker's request can ride on a legitimate prompt | R2B-6 `distinguishable=n` | macOS UI | Disclosure on a mistaken Allow | minimize dialogs; "more than one dialog → Deny all and STOP"; locked keychain | **Yes** | No |
| RC-4 (D-B1) | **P1** | Lock state can't be verified via CLI, so relock can't be evidenced | no tested probe | tooling gap | An unlocked window after a crash goes undetected | design and test a lock probe | **Yes** | **Yes** |
| RC-5 (D-B2) | **P1** | `-T ''` items in a non-login keychain request the keychain password **on every read**, so repeated GUI password entry (phishing, fatigue); the alternative ACL gives silent reads while unlocked | R2B-6 `keychain_password_requested=y`; R2B `password_requested=t` | design trade-off | Password disclosure or silent read window | explicit decision plus test | **Yes** | **Yes** |
| RC-6 (D-B3) | **P1** | Crash or SIGKILL skips the relock; the exposure window is bounded only by the timeout | design analysis | trap-based relock | Prolonged unlocked state | short runs; minimal `-t`; post-run lock check | **Yes** | **Yes** (kill/relock test) |
| RC-7 (D-D2) | **P1** | Keychain-password custody: copy/paste reintroduces clipboard exposure (R0 class) | design analysis | under-specified | Password disclosure | a no-clipboard custody procedure, or an explicit acceptance | **Yes** | No (procedure) |
| RC-8 (=RK-5) | P2 | Silent overwrite/delete (K4/K5 **measured in unlocked throwaway keychains; expected for the login keychain, UNVERIFIED**) | rotation plan §13 | ACL `encrypt` open | Integrity/availability (detected by validation) | dedicated locked keychain (writes need the password while locked) | No (mitigated by design direction) | Yes (locked overwrite, isolated) |
| RC-9 (=RK-11/T10) | P2 | Offline decryption from backups | design | file + password | Disclosure | strong password; backup decision | No | No |
| RC-10 (T7) | P2 | FileVault status not confirmed | — | — | Stolen-Mac exposure | owner confirms FileVault ON | No | No |
| RC-11 (=RK-12/T9) | **P1** | Spoofed or attacker-triggered dialogs (aligned with T2/T9/RC-5) | design | UI | Password phishing | minimize dialogs; STOP on any unexpected dialog | **Yes** (with RC-5) | Prototype |
| RC-12 (D-G1) | P2 | Auditability: no OS-level access audit; the script hash isn't logged | integrity review | tooling | Weaker evidence | log the script hash, ACL, lock probe, mdat | No | Optional (`log show`) |
| RC-13 (8a) | P2 | Login-keychain `-T ''` dialog behaviour untested (the current launcher uses the login keychain) | properties table | scope | Unknown prompt semantics in Production | moot if the dedicated keychain is adopted; otherwise test | No (if dedicated is adopted) | Conditional |
| RC-14 (=RK-14) | P2 | The launcher lacks the R2B-6 input hardening (EOF/IFS/type-ahead) | R2B6 review P1 | launcher predates it | Accidental confirmation or a password in logs | port the hardening | No (before execution: yes) | Self-tests |
| RC-15 | P3 | R2B-4: 4 dialogs for one item; the dump exits 0 when denied | R2B log | unknown | Operator confusion | document; count dialogs in future tests | No | Optional |
| RC-16 | P3 | Older R2B logs are mode 644 (directory 700) | integrity | pre-umask script | Minimal | `chmod 600` (owner) | No | No |
| RC-17 | P3 | R2B-6 provenance inferred (no script hash in the log) | integrity | harness | Weaker evidence | log the hash at start | No | No |
| RC-18 (T5/T6) | P1 (accepted) | Compromised session or privileged admin aren't defended | threat model | architecture limit | Full disclosure | out of scope; endpoint controls | No (documented acceptance needed) | No |
| RC-19 (=RK-10) | **P1** | Server-side plaintext `ALTER ROLE` text in `pg_stat_statements` (confirmed on PG17) | rotation plan §14 | Neon accepts plaintext only | Disclosure to `neondb_owner` holders until restart | R-1 re-acceptance; Phase F restart | No (R-1 gate) | No |
| RC-20 (=RK-7/T4) | **P1** | Automation or Accessibility agents may act on dialogs or use a displayed keychain password (ongoing) | Codex Computer Use had Accessibility ON during run 2 | agents installed with Accessibility | Silent approval or trust change | agents OFF + preflight process check + owner confirmation; never display the keychain password | **Yes** | Prototype preflight |
| RC-21 (=RK-8) | P3 | Test runs outside Terminal.app gave inconclusive results (run 1) | run 1 | environment | Wrong conclusions | procedural (Terminal.app only) | No | No |
| RC-22 (=RK-9) | P3 | Test scripts could alter global keychain state | guards verified | — | Persistent change | harness guards (verified R2B, R2B-6) | No | No |
| RC-23 (=RK-13) | P2 | Keychain Access.app can reveal the secret or widen access control | design | GUI tool | Disclosure / opening | procedural: don't open; ACL checks | No | No |
| RC-24 (=T11) | **P1** | Launcher or SQL files and the psql chain could be tampered with between the hash check and the run (TOCTOU) | rotation plan §13 P1-B partial | same-user write access | Tampered code handles the secret | verify immediately before running; read-only copy; pins | **Yes** (before execution) | No |
