# R2D-01: Locked-Keychain Architecture Proposal (DESIGN ONLY)

**Baseline (AURA-GOV-02-R2C, preserved):**
- R2B-6 VERIFIED PASS; R2B CONDITIONAL PASS;
- **R-2 HOLD**; locked-keychain design REQUIRES DESIGN CHANGES; prototype RECOMMENDED WITH CONDITIONS;
- no P0; P1s open.
- **The original run-2 exposure is not attributed to the user or to automation:** the actor is unverified.

**Boundaries of this package:**
- no keychain created or unlocked;
- no `security` command;
- no password generated or accessed;
- no script executed;
- no Accessibility change;
- no production, Neon, R-1, B4, B5 or B6 change;
- nothing committed.

## 1. Purpose of the prototype
Measure, on a **throwaway** dedicated keychain holding **synthetic** values only, whether keeping a dedicated keychain **locked except during short, controlled windows** adequately limits:
- (a) unintended reads;
- (b) bulk dumps;
- (c) concurrent access and simultaneous dialogs;
- (d) the blast radius of an accidental persistent trust ("Always Allow");
- (e) residual unlocked state after failure.

**Locking is not assumed to prevent any form of disclosure until it is measured** (R2D-03).

## 2. Components

| Component | Prototype form | Production form (future, out of scope) |
|---|---|---|
| Dedicated keychain | `<private mktemp dir>/r2d.keychain-db`, created per run, deleted at the end | `~/Library/Keychains/aura-rot.keychain-db` |
| Keychain passphrase | **owner-chosen synthetic** passphrase, typed only at tty prompts with echo off and into macOS dialogs (R2D-05); never displayed, logged or stored | ≥ 128-bit, password-manager-generated; no-clipboard custody (R2D-05) |
| Items | synthetic 40-character values; item A `-T ''` (no trusted app); item B default ACL (the creator, `security`, trusted), used **only** for the D-B2 comparison | `-T ''` (pending the R2D-03 L6 outcome and an owner decision) |
| Settings | `-l` (lock on sleep), `-t <short>` per test | `-l -t <short>` + watchdog |
| Harness (`r2d_prototype.zsh`, to be written after approval) | single file; hash-pinned; launched only via the hash-then-execute bootstrap (R2D-06) | the production launcher adopts the same controls |
| Watchdog | detached one-shot `security lock-keychain <path>` after N s | same |
| Evidence | `~/aura-r2b-evidence/r2d-<UTC>.log` (0600; sanitized; the script hash first) | same pattern |

## 3. Lifecycle (prototype, each test)
1. **Preflight (Tier 1, R2D-02):** any failure is NO-GO.
2. **Create:** create the keychain (passphrase via tty prompt or stdin, **never argv**). Settings. Add the synthetic items via `security -i` stdin (never argv). **Lock immediately.**
3. **Test step:** the probe state is recorded **before and after** every action. ACL with identities recorded **before and after**.
4. **Relock:** explicit `lock-keychain` after every unlocked window. The watchdog is armed whenever unlocked.
5. **Teardown (R2D-07):** reap all children; cancel the watchdog; lock; delete the keychain; verify file, search list and default unchanged; log the verdict.

## 4. Design choices to be **decided by measurement**, not assumed
- **D-B1 lock-state probe:** which non-mutating command (if any) distinguishes locked from unlocked **without a dialog and without changing state** (L1).
- **D-B2 per-read dialogs vs unlocked window:**
  - `-T ''` means a dialog plus a passphrase on each read (phishing surface, RC-5/RC-11);
  - the default ACL means silent reads by any same-user process during the unlock window (RC-1).
  - L6 measures both. **The production choice needs explicit, recorded owner acceptance.**
- **Trust while locked:** whether an "Always Allow" trust grants **anything** while the keychain is locked (L10).
- **D-B3 relock robustness:** timeout, watchdog, sleep, crash (L7–L9).

## 5. Accepted threat-model limitation (stated separately)
**An attacker with control of the user's macOS session** (code execution as the user, keylogging, UI control) **or with administrative privileges** is **not** defended by this architecture.
- Such an attacker can:
  - capture the passphrase at entry;
  - read process memory during the window;
  - copy the keychain file and attack it offline;
  - or drive the UI.
- This limitation (R2C RC-18 / T5 / T6) **requires the owner's explicit acknowledgement** (R2D-08). Defending against it needs hardware-backed or external custody, which is out of scope.

## 6. What the architecture cannot claim even if every prototype test passes
- Protection after any "Always Allow" **while unlocked**.
- Protection against indistinguishable simultaneous dialogs (mitigated only procedurally).
- Protection against an automation agent with Accessibility (mitigated procedurally, by attestation).
- Results beyond macOS 14.6 on this Mac, a single dedicated keychain, and the tested commands.
