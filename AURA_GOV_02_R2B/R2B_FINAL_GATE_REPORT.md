# R2B: Final Gate Report

**Gate verdict: HOLD.** R-2 remains HOLD. Not PASS. R-1 is not advanced. No interactive test was executed. No Production access.

## Observed facts
1. The original script (`r2_verify.zsh` `47e8c39d…`) targets only an explicit throwaway keychain. Every `security` call names it (audit Q7).
2. Run 2 (Terminal): R2-1 Deny `rc=128`; R2-2 Allow `rc=0`+match; R2-3 `rc=128`; R2-3b ACL `(0)`; **R2-3c `secret_in_dump=1`**; R2-6a/b silent `rc=0`; **R2-4 `secs=0`**; R2-5 silent; **R2-5b ACL `(1)`**. Owner: for Allow and Always Allow, the password-less click was rejected and the same dialog stayed open.
3. Run 1 (via the app's input box): every read `rc=128`; ACL `(0)` throughout; no secret returned.
4. Measured today, without dialogs:
   - `create-keychain` doesn't add the file to the user search list;
   - a new keychain defaults to `lock-on-sleep timeout=300s`, and bare `set-keychain-settings` sets `no-timeout`;
   - the ACL `requirement:` line identifies the trusted application (`identifier "com.apple.security" and anchor apple`).
5. Cleanup of both runs was verified externally: no throwaway file or directory left, search list unchanged.

## Supported conclusions
- **"Allow" is one-time and doesn't change the ACL** (R2-2 → R2-3, R2-3b). Verified.
- **A `-T ''` item isn't silently readable by single reads while its ACL is `(0)`** (R2-1, R2-3). Verified.
- **"Always Allow" makes the item silently readable by every `security` caller**, including concurrent ones (R2-5b and the later silent reads). Verified as an effect.
- **The run-2 sequence is fully explained by one Always Allow given on the R2-3c bulk-dump dialog.** R2-6a/b and R2-4 completed in under 1 s, so none of their dialogs can have been the one answered. **Supported; UNVERIFIED.** It implies a click against the on-screen "Deny" instruction, which conflicts with the owner's recollection. **An automation agent (Codex Computer Use, Accessibility ON) is a live alternative.**
- **The secret-detection logic is sound.** `secret_in_dump=1` reflects a real decrypted value, not echoed text (audit Q10–11).
- **Dialogs can't be reliably tied to the intended step.** This is a test-design defect (S1–S4), and it's also a **design-level risk** for any procedure that relies on the owner choosing correctly among several similar dialogs (RK-1).

## Unverified hypotheses
- **(B):** `dump-keychain -d` decrypts without a per-item prompt. Not supported by run 2 alone (it can't explain the ACL change), and not excluded. **R2B-4 decides it.**
- The R2-6 dialog count before trust (0, 1 or 2).
- The run-1 cause (whether dialogs were shown when launched from the app's input box).
- The exact identity of the run-2 `(1)` trusted entry (most likely `com.apple.security`).

## Security implications
- The current R-2 control (login keychain + `-T ''`) holds **only while no Always Allow is ever granted**. A single misattributed click, which is realistic as run 2 shows, gives **persistent silent access** to any same-user process.
- That makes the control **fragile in practice**, beyond the already-documented integrity gap.
- If (B) is confirmed, the control is **ineffective** against bulk dumps.

## Proposed mitigation
1. **Run the isolated R2B test** (`r2b_isolated.zsh` `72d13e72…`, revised after review: validated input, never-logged invalid input, extra STOP rules), after explicit owner approval, in Terminal with Codex Computer Use OFF. It decides (B) and the concurrency behaviour without any Always Allow.
2. **Adopt the dedicated locked keychain** (design doc), validated by an extended isolated test (locked read, locked dump, locked overwrite, unlock/lock cycle).
3. **Reduce dialogs in the rotation launcher.** Prefer keeping the value in memory through ALTER and validation, and verifying the stored copy once in a separate, deliberate step. Every launcher dialog prints its step ID and requires an owner confirmation keypress before the request is issued.
4. Keep the `ROT FINAL` ACL check (now with identity) and **STOP plus re-rotate on any non-`(0)` ACL**.

## Evidence references
- `R2B_SCRIPT_AUDIT.md` (line-referenced audit; run reconciliation; defects S1–S7)
- `R2B_AUTHORIZATION_ANALYSIS.md` (state model; verified vs unverified)
- `R2B_ISOLATED_TEST_PLAN.md` + `r2b_isolated.zsh` `72d13e72…` (self-tests dialog-free; input-validation pty test: a password typed into the terminal is rejected and never logged)
- Independent review of this package: **AGREE WITH CHANGES** (no P0/P1). HOLD confirmed; all P2/P3 findings applied
- `R2B_LOCKED_KEYCHAIN_DESIGN.md`
- `R2B_RISK_REGISTER.md`
- Rotation plan `AURA_GOV_02_I0_C_B2B_R_ROTATION_PLAN.md` §13–15 (K1–K8, P1-A fix, PG17 results)

## Acceptance checklist

| Criterion | Status |
|---|---|
| Original script fully audited | ✔ (`R2B_SCRIPT_AUDIT.md`) |
| All R-2 observations reconciled with command execution | ✔ (one gap: R2-3c `secs` not reported, so attribution is SUPPORTED/UNVERIFIED) |
| Bulk-dump secret detection independently reviewed | ✔ (Q10–11; sound) |
| ACL state and lock state distinguished | ✔ (lock state by construction; not directly measurable without side effects) |
| Persistent-authorization timing assessed | ✔ (between R2-3b and R2-6; R2-4 excluded by `secs=0`) |
| Concurrent-read behaviour investigated | ◐ (run 2 post-trust only; pre-trust behaviour in R2B-6) |
| Disposable cleanup verified or documented | ✔ (both runs externally verified; R2B self-verifies) |
| Isolated R2B test prepared, not executed without approval | ✔ (self-test only: no reads, no dialogs) |
| Locked-keychain alternative evaluated at design level | ✔ |
| Remaining uncertainties documented | ✔ |

## Explicit next-step recommendation
- **(1)** Owner, from run 2 if available:
  - the **full Terminal scrollback** (especially the R2-3c `secs` value);
  - the **total number of dialogs** you saw, and whether any appeared at R2-6 or R2-4;
  - whether **Codex or ChatGPT** was running at the time.
  - Dialogs seen at R2-6 or R2-4 would contradict (A).
- **(2)** Owner approval to run `r2b_isolated.zsh` (Terminal; Codex Computer Use OFF; Deny/Allow as instructed; **no Always Allow**).
- **(3)** Depending on R2B-4: if the bulk dump prompts, proceed to the locked-keychain design and its test. If the bulk dump is silent, **NO-GO** for any login-keychain-based storage, and redesign.
- **R-2 stays HOLD. B4, B5, B6 and R-1 stay HOLD. Freeze maintained.**
