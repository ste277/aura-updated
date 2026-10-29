# R2B: Authorization-State Analysis

## Concepts kept separate

| Concept | What it is | How it was observed |
|---|---|---|
| **Keychain lock state** | Whether the keychain's master key is available. A **locked** keychain refuses or prompts for *any* item operation, including writes. | Not directly observed. By construction the run-2 keychain was **unlocked throughout** (created unlocked; bare `set-keychain-settings` made it `no-timeout`). Measured separately: a new keychain defaults to `lock-on-sleep timeout=300s`. Reviewer-measured earlier: writes to a **locked** throwaway keychain fail (`User canceled`) |
| **Item ACL trusted applications** | The per-item list of applications allowed to decrypt **without** a dialog | `dump-keychain -a` → `applications (0)` / `(1)`. **The count alone doesn't identify the application.** Earlier measurement (default item) shows the entry is printed as `requirement: identifier "com.apple.security" and anchor apple`. **The run-2 `(1)` entry's identity wasn't captured, so it is UNVERIFIED that it is `/usr/bin/security`** (highly likely: the only requester) |
| **One-time authorization ("Allow")** | Grants the pending request only | Run 2: R2-2 succeeded and R2-3 prompted again and was denied; R2-3b still `(0)`. **Verified on this Mac: "Allow" does not persist across separate `security` processes and doesn't change the ACL** |
| **Persistent authorization ("Always Allow")** | Adds the requesting application to the item's trusted list. Every later read by that application (here `/usr/bin/security`, used by **any** same-user process) is silent | Run 2: the ACL went `(0)` → `(1)` and later reads were silent (`secs=0`). **Verified as an effect.** The exact moment it was granted is attributed to R2-3c (SUPPORTED, UNVERIFIED; see the audit) |
| **Process or session caching** | Whether securityd caches a grant per process or session | No evidence of caching. After R2-2's Allow, R2-3 (a new process) prompted again. **Concurrency** (two `security` processes at once, before trust) **was not observed in run 2**, because R2-6 ran after trust. **UNVERIFIED** |
| **Interactive vs silent retrieval** | `secs=0` (integer) proves **no answered dialog**; `secs≥1` is **consistent with** a dialog but not proof (it may cross a second boundary) | Run 2: R2-1, R2-2 and R2-3 interactive; R2-3c unknown (secs not reported); R2-6/R2-4/R2-5 silent **after** trust |

## Specific determinations

1. **Is `applications (0)` alone sufficient evidence that every read must prompt?**
   - **No.** It shows no application is trusted **at that moment**. Every read prompts **until** a user grants "Always Allow" to some application.
   - It says nothing about **lock state** (an unlocked keychain is required for the dialog path), **write and delete protection** (none), or the **bulk-dump path** (see 3).
   - The property holds only while the ACL is re-checked to be `(0)`.
2. **Does `applications (1)` identify the trusted executable?**
   - **Not by count.** The identity is on the following `requirement:` line (e.g. `identifier "com.apple.security" and anchor apple`), which the original `acl()` parser (L12) didn't print.
   - Because that requirement is the **Apple-signed `security` binary**, trusting it means **every same-user process that runs `/usr/bin/security`** can read silently. That is the hazard.
   - **The run-2 identity is UNVERIFIED.**
3. **Does `dump-keychain -d` respect the per-item ACL prompt?**
   - **UNVERIFIED.** Run 2 can't distinguish "a dialog appeared and was answered Always Allow/Allow at R2-3c" (A) from "the dump path is silent" (B).
   - (B) alone is **inconsistent** with the ACL changing to `(1)`. (A) explains every observation.
   - The isolated test R2B-4 resolves it: a dump **before any trust**, with the owner recording whether a dialog appears and choosing Deny.
4. **Did the owner's first (password-less) click create extra requests?**
   - Per the owner, the same dialog stayed open. **Not inferred otherwise.**
5. **Is a successful `security` command proof of a particular mechanism?**
   - **No.** `rc=0` with a match shows the value was released. It doesn't show *why*: one-time grant, trusted ACL, or an un-prompted path.
   - Mechanism is assigned only together with the ACL state and the timing, and the owner's recorded click (in R2B).

## Summary of what is and isn't established

| Claim | Status |
|---|---|
| A `-T ''` item can't be read silently while its ACL is `(0)` (single `find-generic-password`) | **VERIFIED** (R2-1, R2-3; earlier K3) |
| "Allow" is one-time and doesn't modify the ACL | **VERIFIED** (R2-2 → R2-3, R2-3b) |
| "Always Allow" makes all later `security` reads silent, for any same-user process | **VERIFIED as an effect** (R2-5b `(1)`, silent R2-6/R2-4/R2-5) |
| The run-2 Always Allow was granted on the R2-3c dialog | **SUPPORTED, UNVERIFIED.** It implies a click against the on-screen instruction; an automation agent (Accessibility ON) is a live alternative |
| `dump-keychain -d` prompts per item before trust | **UNVERIFIED** |
| Two concurrent reads before trust produce two dialogs | **UNVERIFIED** |
| A dialog can be reliably attributed to the intended operation | **NOT SUPPORTED.** Run 2 shows misattribution is realistic |
| Keychain lock state during run 2 | **Unlocked by construction** (not directly measured) |
