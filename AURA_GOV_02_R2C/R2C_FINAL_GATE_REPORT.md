# R2C: Final Gate Report

**Read-only review.**
- No Keychain operation, no script execution, no credential access.
- No production change, commit, merge or release.
- **R-1, B4, B5 and B6 remain HOLD. The security freeze is maintained.**

## 1. Evidence integrity: ESTABLISHED
- R2B manifest **7/7**; R2B6 **6/6**; I0-C artifacts 27/27.
- Logs:
  - `r2b-20261112T071432Z.log` `fdfce7ca…b224`;
  - `r2b6-20261114T030606Z.log` `cfb0f7bf…1045`.
- Both are sanitized: 0 forty-character tokens; no password or token patterns.
- R2B-6 script provenance (`e7e7efa6…`) is **strongly supported** (field evidence, mtime, manifest), not proven: the hash isn't logged.

## 2. R2B-6: **VERIFIED PASS**
From the raw log:
- **Readers:** PIDs 92261 and 92262 (self-PID equals the launched PID).
- **Exit codes:** both `rc=128` (record equals `wait` status).
- **Secrets:** `secret_returned=no` for both.
- **Timing:** started 1.1 ms apart and **overlapped for 8.19 s** (03:06:22.227Z→03:06:30.418Z).
- **Owner observations:** 2 dialogs, both denied, both naming `security` and the item, no login password.
- **ACL:** `(0)` before and after.
- **Cleanup:** verified.

**Limitations:**
- the dialogs were indistinguishable;
- observations are owner-reported (corroborated by `rc` and timing);
- the earlier in-run attempt's outcome is unknown.

## 3. Decision matrix

| Decision | Outcome | Justification |
|---|---|---|
| **1. R2B verification** | **CONDITIONAL PASS** | Deny (single, repeated, post-dump), one-time Allow, bulk dump with all dialogs denied, and concurrent Deny are all evidenced. **Conditions:** unlocked throwaway keychains only; n=1 run per test; dialog content owner-reported; the `071207Z` login-password discrepancy unexplained; R2B-6 satisfied by a separate retest. **Not covered:** locked state, the login keychain, Always Allow in isolation |
| **2. R-2 security gate** | **HOLD: DESIGN CHANGES REQUIRED** | Open P1s: RC-1 persistent trust via `/usr/bin/security`; RC-2/RC-20 human or automation approval; RC-3 indistinguishable concurrent dialogs; RC-4 lock state unverifiable; RC-5/RC-11 password-entry dialogs (phishing); RC-6 crash leaves the keychain unlocked; RC-7 keychain-password custody; RC-24 launcher TOCTOU. Plus RC-18 (privileged or compromised actor) **accepted as out of scope**, which needs owner acknowledgement |
| **3. Locked-keychain prototype** | **RECOMMEND WITH CONDITIONS** | It materially improves at-rest integrity and confidentiality, and is expected to limit the blast radius of an Always Allow. **Conditions:** Tier 1 design changes applied first (D-A1, D-C1/2, D-D1–4, D-G1); a throwaway keychain only; automation confirmed OFF; no production credentials |
| **Design readiness** | **REQUIRES DESIGN CHANGES** | Tier 1 before the prototype; Tier 2 measured by the prototype; production adoption needs every D-* closed |

## 4. Remaining P0/P1 risks
- **P0:** **none.** No uncontrolled exposure was demonstrated **under the tested controls**. The run-2 exposure followed a trust grant by an unidentified actor.
- **P1:**
  - RC-1 persistent `security` trust;
  - RC-2 run-2 approval actor (historical);
  - RC-20 automation (ongoing);
  - RC-3 indistinguishable dialogs;
  - RC-4 lock-state probe;
  - RC-5 / RC-11 password-entry dialogs and phishing;
  - RC-6 crash relock;
  - RC-7 keychain-password custody;
  - RC-24 launcher TOCTOU;
  - RC-19 server-side plaintext statement (R-1 gate);
  - RC-18 privileged or compromised actor (accepted out of scope; owner acknowledgement required).

## 5. Proposed next ticket (separate authorization required)

**AURA-GOV-02-R2D: Isolated Locked-Keychain Prototype Test.**
- **Scope:** a throwaway dedicated keychain and a synthetic value only. No production credentials or launcher changes.
- **Prerequisite:** Tier 1 design changes are applied in a prototype harness and independently reviewed. Owner confirmation that automation is off.
- **Must measure (Tier 2):**
  - **D-B1:** a side-effect-free lock-state probe, validated against known locked and unlocked states.
  - **Reads while locked:** `find -w` (expected unlock prompt), `dump -d`, `add -U`, delete. Record the dialog type, count and password requested.
  - **D-B2:** compare `-T ''` with the default ACL inside the locked keychain: dialogs per read and silent-read window.
  - **Always Allow while locked:** an isolated Always Allow on the throwaway item (owner, automation off), then **lock**, then read, to see whether trust is limited to the unlocked window.
  - **D-B3:** a `kill -9` of the harness while unlocked, then measure relock via the timeout and the watchdog; sleep/wake lock (`-l`).
  - **Custody:** a no-clipboard unlock procedure (D-D2), with the script hash logged (D-G1).
- **Out of scope:** production rotation, R-1, B4, B5 and B6.

## 6. Interactive evidence gaps (would need separate authorization)
1. R2-3c's `secs` from run 2, if the owner still has the Terminal scrollback (retrospective; no new test).
2. Every Tier 2 item above.
3. Login-keychain `-T ''` dialog semantics (RC-13). Only needed if the login keychain is retained.

**Stop for owner review.**
