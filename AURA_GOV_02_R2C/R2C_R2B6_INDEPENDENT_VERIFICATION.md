# R2C: Independent Verification of R2B-6 (Phase B)

**Source:** `~/aura-r2b-evidence/r2b6-20261114T030606Z.log`, sha256 `cfb0f7bf…1045`. Line numbers (Lx) refer to that file.

**Decision: R2B-6 VERIFIED PASS** for the stated property. Limitations are listed below.

| Requirement | Evidence | Verified |
|---|---|---|
| Reader A exit code 128 | L6 `rc=128 … wait_rc=128` | ✔ (the reader's own record and the parent's `wait` status agree) |
| Reader B exit code 128 | L7 `rc=128 … wait_rc=128` | ✔ |
| Reader A secret returned: no | L6 `secret_returned=no` | ✔ |
| Reader B secret returned: no | L7 `secret_returned=no` | ✔ |
| Overlap demonstrated by timestamps | L6/L7: A 03:06:22.225Z→03:06:30.418Z (8.192 s); B 03:06:22.227Z→03:06:34.998Z (12.772 s); start gap **1.1 ms**; **overlap 8.191 s**; L8 `overlapping=yes` | ✔ (recomputed independently from the raw epoch values) |
| Two dialogs | L10 `dialogs=2` | ✔ owner-reported. Corroborated by timing: each reader blocked for seconds, then ended 4.58 s apart, consistent with two dialogs denied one after another |
| Both denied | L10 `all_denied=y` | ✔ owner-reported; consistent with `rc=128` (the same code as the R2B-1/3/5 denies) |
| Application identity `security` | L10 `app_security=y` | ✔ owner-reported |
| Expected disposable item | L10 `item_expected=y`; L3 item `r2b6acct/R2B6-ITEM` in `<private temp>/r2b6.keychain-db` | ✔ |
| ACL before `applications (0)` | L3 | ✔ |
| ACL after `applications (0)` | L9 | ✔ (no trusted application added, so no persistent authorization) |
| Mac login password requested: no | L10 `login_password_requested=n` | ✔ owner-reported |
| Cleanup verified | L12 (readers reaped; file and directory removed; search list and default unchanged) | ✔ |

**Concurrency analysis:**
1. **Two independent reader processes:** L5 launched PIDs 92261 and 92262. Each reader's self-recorded PID equals the PID the parent launched (L6/L7: `self_pid` = `parent_pid`).
2. **Unique PIDs:** yes.
3. **Same item:** both run `find-generic-password -a r2b6acct -s R2B6-ITEM -w <same throwaway path>` (script, by inspection).
4. **Overlapping intervals:** yes, for 8.191 s, during which **both requests were pending at once**.
5. **No secret:** yes, for both.
6. **Expected result:** `rc=128` (user-cancelled / denied) for both.
7. **No persistent authorization:** the ACL was unchanged.

**Earlier in-run R2B-6 attempt** (`r2b-20261112T071432Z.log`, last lines):
- two real concurrent reads were launched;
- the run then STOPped on invalid input (len=1), and the results were never logged;
- cleanup destroyed the keychain and files.
- Recorded as **"attempt executed, outcome unknown, no persistence possible (throwaway destroyed)"**.
- The PASS above comes from the **separate retest** with a different script (`r2b6_concurrency_retest.zsh`).

## Limitations (none invalidates the PASS)
- **Dialog-to-reader mapping is unknowable:** `distinguishable=n`. Because **both** readers failed and **both** dialogs were denied, the mapping doesn't matter for this property. It **does** matter operationally: a second, attacker-initiated dialog arriving alongside a legitimate one couldn't be told apart (RK-4, carried forward).
- **Owner observations are self-reported.** They are corroborated by `rc` and timing, not independently observed.
- **`stderr_class=none`:** `security` wrote nothing to stderr on the denied reads. The class field therefore carries no information. `rc=128` is the discriminator.
- **Provenance:** the script hash isn't logged; it is inferred (see Integrity).
- **Scope:** an unlocked throwaway keychain, no prior trust, a single item, macOS 14.6. The keychain password was requested and **not** entered.
