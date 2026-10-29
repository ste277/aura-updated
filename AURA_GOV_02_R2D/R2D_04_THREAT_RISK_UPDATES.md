# R2D-04: Threat-Model and Risk-Register Updates

Every outstanding R2C P1 is accounted for. None is closed by this design package: closure requires prototype evidence and owner decisions.

| R2C risk | Sev | Addressed by (control / test) | Status after R2D design | Closes when |
|---|---|---|---|---|
| RC-1 persistent `/usr/bin/security` trust | P1 | T1-2 ACL + identity before and after (STOP on OPEN); L10 measures whether lock contains the trust; L11 detector positive control | OPEN (design ready to measure) | L10 PASS **and** the owner accepts the residual "Always Allow while unlocked" |
| RC-2 run-2 approval actor (historical) | P1 | Not resolvable retrospectively; T1-6 **reduces** the chance of recurrence procedurally | OPEN (historical; documented) | owner acknowledgement |
| RC-20 automation (ongoing) | P1 | T1-6 attestation + process check; re-attestation before L10 | OPEN (procedural control; no technical enforcement) | owner acceptance of the procedural control |
| RC-3 indistinguishable concurrent dialogs | P1 | L5, L12 characterize; rule "more than one dialog → Cancel all and STOP"; D-B2 choice minimizes dialogs | OPEN | owner acceptance after L5/L12 |
| RC-4 lock state unverifiable | P1 | **L1** probe | OPEN | L1 PASS (a deterministic, non-mutating, dialog-free probe) |
| RC-5 / RC-11 password-entry dialogs and phishing | P1 | L6 + L12 measure dialog counts and types; custody rule "enter only at announced steps naming this keychain" (R2D-05) | OPEN | owner D-B2 decision with measured numbers |
| RC-6 crash leaves the keychain unlocked | P1 | Watchdog + `-t` + `-l`; L7, L8, L9 | OPEN | L7–L9 PASS |
| RC-7 keychain-passphrase custody | P1 | R2D-05 | Design complete; **owner approval required** | owner approves R2D-05 |
| RC-24 launcher TOCTOU | P1 | R2D-06 hash-then-execute-from-memory (race closed, verified); fresh `env -i` window; `env -i shasum`; `builtin print` | **Design complete; residual (persistent same-user write to shell startup or env) mapped to RC-18; NOT closed** | bootstrap and fresh-window self-tests PASS + review + owner acceptance of the residual |
| RC-19 server-side plaintext (R-1 gate) | P1 | Not a Keychain issue; unchanged | OPEN (R-1) | R-1 re-acceptance + Phase F restart |
| RC-18 compromised session / admin | P1 (accepted) | **Accepted limitation** (R2D-01 §5) | ACCEPTANCE REQUIRED | owner signs R2D-08 |
| RC-8 silent overwrite/delete | P2 | L4 measures locked overwrite/delete | OPEN | L4 PASS |
| RC-9 / T10 backups | P2 | R2D-05 §8 | OPEN (owner decision) | decision |
| RC-10 FileVault | P2 | Owner checklist item | OPEN | owner confirms FileVault ON |
| RC-12 auditability | P2 | Harness logs hash, macOS, `csrutil`, probes, ACLs, dialogs | Design complete | harness review |
| RC-13 login-keychain semantics | P2 | Moot if the dedicated keychain is adopted | OPEN (conditional) | adoption decision |
| RC-14 launcher input hardening | P2 | Tier 1 carry-overs | Design complete | harness review |
| RC-15 dump 4 dialogs / `rc=0` | P3 | L3 counts dialogs while locked | OPEN | L3 recorded |
| RC-17 provenance (hash not logged) | P3 | **T1-4** (the harness logs its executed-bytes hash) | Design complete | harness review |
| RC-23 Keychain Access.app | P2 | **T1-1** (search-list check) + procedural "don't open Keychain Access" | OPEN (procedural) | — |
| RC-16 / 21 / 22 | P3 | unchanged (procedural or harness) | as R2C | — |
| D-G2 OS-level audit (`log show` for securityd) | P3 | not adopted in R2D; optional future evaluation | OPEN (optional) | — |

**New design risks introduced by R2D:**
- **RD-1 (P2):** item B (default ACL) **intentionally** trusts `security` inside the throwaway keychain. That's acceptable for synthetic values only. The harness creates item B **only for L6 and L11** (and C only for L11), and the L11 detector must flag both.
- **RD-2 (P2):** L7 deliberately leaves the throwaway keychain unlocked after `kill -9`. Synthetic values only; bounded by the watchdog.
- **RD-3 (P2):** L10 deliberately grants Always Allow. Synthetic values only; the keychain is destroyed immediately afterwards.
- **RD-4 (P3):** the probe commands in L1 may themselves raise dialogs. The owner must Cancel, and the test records it.
