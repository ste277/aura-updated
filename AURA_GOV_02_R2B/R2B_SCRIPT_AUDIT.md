# R2B: Script Audit of `r2_verify.zsh` (read-only)

- **File:** `AURA_GOV_02_I0_C_ARTIFACTS/rot/r2_verify.zsh`, sha256 `47e8c39d2096c058342bcc7637a8f7768d9adcf33dabff327e53373eb04cd914`.
- The file is unmodified since the run, matches the manifest, and has 33 lines.
- Line numbers refer to that file.
- This audit made **no** change to the script.

## Answers to the 13 audit questions

| # | Question | Finding (line) |
|---|---|---|
| 1 | Keychain creation and configuration | L5: private dir via `mktemp -d` under `umask 077`. L6: `KC=$D/r2verify.keychain-db`, password `KP='r2-throwaway'`. L9: `security create-keychain -p "$KP" "$KC"` (the dummy password is in argv, which is acceptable for a dummy), then `security set-keychain-settings "$KC"` **with no options**. |
| 2 | Active/default keychain? | **No.** Explicitly targeted only. Measured on this Mac: `create-keychain` does **not** add the file to the user search list (before, during and after: `login.keychain-db` only), and the default keychain is not changed. |
| 3 | Unlocked throughout? | **Yes, by construction.** `create-keychain -p` leaves the keychain unlocked. Measured: a new keychain defaults to `lock-on-sleep timeout=300s`, and L9's bare `set-keychain-settings` changes it to **`no-timeout`** (and no lock-on-sleep). Nothing locks it before cleanup. The lock state isn't directly queryable with the `security` CLI without side effects, so this is **inferred from construction**, not measured during the run. |
| 4 | Item and ACL creation | L11: `add-generic-password -a r2acct -s R2-VERIFY-ITEM -T '' -w <V> <KC>`, piped via `printf` (a builtin) into `security -i` stdin. Output is discarded and **the exit code is unchecked**. L16 (R2-0) confirms the ACL afterwards. |
| 5 | What `-T ''` establishes | The decrypt/export ACL entry gets an **empty trusted-application list** (`applications (0)`). Every read by any application requires an authorization dialog. Per the earlier measurement (K2), `change_acl` is also `applications (0)`. It does **not** restrict writes (`encrypt` is `applications: <null>`) or deletion (K4/K5). |
| 6 | Commands per step | R2-1/R2-2/R2-3/R2-6a/R2-6b/R2-4/R2-5: `rd()` (L13) = `security find-generic-password -a r2acct -s R2-VERIFY-ITEM -w "$KC"`. R2-3c (L22) = `security dump-keychain -d "$KC" </dev/null`. R2-0/3b/5b (L12) = `security dump-keychain -a "$KC" \| awk …` (ACL only; no decryption). |
| 7 | Every command targets the disposable keychain? | **Yes.** Every `security` call passes `"$KC"` (L9, L11, L12, L13, L22, cleanup L7). None names the login or system keychain or relies on the search list. |
| 8 | Any ACL or trust modification by the script? | **None in the script's own commands.** The only way the ACL can change is **through a dialog choice** ("Always Allow"), which adds the requesting application (`/usr/bin/security`) to the trusted list. |
| 9 | Background processes / shared temp files | L23–24 (R2-6): two background subshells, each running `rd`; `wait`. No shared files. The secret stays in shell memory (`V`, `R`); the dump output is in the variable `O`. |
| 10 | Secret detection | `rd`: `[[ -n $R && $R == $V ]]` (exact equality on `-w` output). R2-3c: `[[ -n $O && $O == *$V* ]]`. `V` is 40 `[A-Za-z0-9]` characters, so there are no glob metacharacters and this is a literal substring test. |
| 11 | False positives from echoed commands or diagnostics? | **No realistic false positive.** stderr is discarded (L13, L22); the script never echoes `V`; `dump-keychain -d` prints only keychain contents. A 40-character random value can't appear by coincidence. **So `secret_in_dump=1` means the dump really contained the decrypted value.** |
| 12 | Ordering of execution, interaction and timing | **Defects affecting attribution:** **(a)** each step prints its instruction and **immediately** starts the command; nothing **pauses for the owner** or **records what the owner clicked**. **(b)** `secs` uses zsh `$SECONDS` (integer, 1 s resolution). **(c)** R2-3c's exit code isn't captured. **(d)** a dialog that is still open or delayed can't be tied to a step: the dialogs don't name the step, and R2-6 deliberately creates two identical dialogs. **(e)** the order is R2-3 → R2-3b → **R2-3c** → **R2-6** → **R2-4** → R2-5 → R2-5b. Every step after the first persistent-trust event inherits it. |
| 13 | Cleanup | L7–8: `trap cleanup EXIT` runs `security delete-keychain "$KC"` and `rm -rf "$D"`. **Not self-verified** in the script. **Verified externally after the owner's run:** the throwaway file and directory are gone, no test processes remain, and the user search list is `login.keychain-db` only. |

## Reconciliation of the two runs

| Run | How launched | Results | Reconciliation |
|---|---|---|---|
| Run 1 (pasted into this app, 2026-11-11) | the app's shell (`<bash-input>`), not Terminal.app | all reads `rc=128`, all in 1–3 s except R2-1 (9 s); ACL stays `(0)` | Consistent with authorization requests that ended as **cancelled**. Whether dialogs were shown or delivered from that shell is **UNVERIFIED** (no owner observation for run 1). No secret was returned. |
| Run 2 (Terminal; ticket evidence) | Terminal.app | as listed in the ticket table | reconciled below |

**Run 2, step by step** (owner-confirmed facts: for both "Allow" and "Always Allow", the first click without a password was rejected and the **same** dialog stayed open; the owner then entered the throwaway password and clicked again):

| Step | Command | Observed | Interpretation |
|---|---|---|---|
| R2-0 | ACL dump | `(0)` | restricted, as designed |
| R2-1 | read | `rc=128`, no secret | owner Deny |
| R2-2 | read | `rc=0`, match | owner Allow (with password): one-time authorization for **that** request |
| R2-3 | read | `rc=128`, no secret | a **new** dialog appeared and was denied, so **Allow did not persist**. **Supports** the design |
| R2-3b | ACL dump | `(0)` | no trust added by Allow |
| R2-3c | `dump-keychain -d` | **`secret_in_dump=1`** | the dump decrypted the item. Either **(A)** a dialog appeared and was answered with **Always Allow** (or Allow), or **(B)** the dump path doesn't enforce the ACL prompt |
| R2-6a/b | 2 reads | both `rc=0`, `secs=0`, match | **silent**: by this point `security` was already trusted |
| R2-4 | read | `rc=0`, **`secs=0`**, match | **No dialog can have been answered here.** A password-entry dialog can't complete within the same second. The owner's Always Allow therefore **did not happen at R2-4** |
| R2-5 | read | `rc=0`, `secs=0`, match | silent (expected after trust) |
| R2-5b | ACL dump | **`(1)`** | `security` added to the trusted list |

**Conclusion of the reconciliation:**
- The ACL went from `(0)` at R2-3b to `(1)` at R2-5b.
- R2-6a, R2-6b and R2-4 all reported `secs=0` (integer `$SECONDS`; 0 means under 1 s, so no answered dialog), which leaves **R2-3c as the only remaining window**. Note: `secs=1` would *not* prove a dialog (a short call can cross a second boundary); only `secs=0` is conclusive.
- The owner reports exactly one Always Allow interaction.
- **The single most consistent explanation (A): the owner's "Always Allow" was applied to the R2-3c bulk-dump dialog.** That made `/usr/bin/security` a trusted application, so all later reads were silent.
- (B) alone can't explain the ACL change to `(1)`, because the script's commands never modify ACLs.
- **Alternatives considered:**
  - **(A') Allow-once at R2-3c plus something else adding trust:** excluded, because no interactive step remains between R2-3c and R2-6.
  - **(b) Human-factors contradiction:** at R2-3c the last on-screen instruction was "click DENY". The R2-4 "ALWAYS ALLOW" text is printed only after R2-6 completes, because the script blocks. So (A) means Always Allow was clicked **against the on-screen instruction**, which conflicts with the owner's recollection of clicking it at R2-4.
  - **(c) Automation agent:** Codex Computer Use had Accessibility **ON** (RK-7), and the throwaway password `r2-throwaway` was printed on screen. An agent could have answered the dialog. **Not excluded.**
- The conclusion also depends on the run-2 values having been transcribed correctly.
- **Status: (A) is SUPPORTED but UNVERIFIED.** It needs R2-3c's `secs` value from run 2, which wasn't in the ticket (≥ several seconds means a dialog was answered there), and/or the isolated R2B-4 test.
- **This is a test-design attribution failure, not evidence of an ACL bypass.** It also shows that **dialogs can't be reliably tied to the intended operation**. That is ticket STOP condition 6, observed in practice.

## Script defects (for the record; not fixed in this ticket)

| ID | Line | Defect | Effect |
|---|---|---|---|
| S1 | 17–27 | no per-step pause or confirmation; no record of the owner's click | dialog-to-step misattribution (run 2) |
| S2 | 13–14, 22 | `$SECONDS` 1-s resolution; R2-3c exit code not captured | weak timing evidence |
| S3 | 21–27 | no STOP when an unexpected silent success or ACL change occurs; the test continues and compounds | all later steps contaminated |
| S4 | 23–24 | concurrency test (two identical dialogs) placed before the persistent-trust step, without isolating per-process outcomes | ambiguous |
| S5 | 11 | `add` exit code unchecked | silent setup failure possible (not observed: R2-0 showed the item) |
| S6 | 7 | cleanup not self-verified | verified externally this time |
| S7 | 9 | bare `set-keychain-settings` removes the default 300 s auto-lock | the test covers an always-unlocked keychain only |
