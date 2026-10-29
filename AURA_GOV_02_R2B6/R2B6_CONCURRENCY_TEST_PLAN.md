# R2B6: Concurrency Retest Plan (PREPARED, NOT EXECUTED; requires owner approval)

**Script:** `AURA_GOV_02_R2B6/r2b6_concurrency_retest.zsh`, 155 lines, sha256 `e7e7efa6704b6caf2e0cb26538b93bd41b6bada1dee7e0019466e8d2bc9a335c` (also in `SHA256SUMS`). Post-review: EOF and whitespace are never confirmation; PASS requires rc=128 for both and dialogs naming `security` and the item; there is an extra keychain-password question (asked before the distinguishability question).

## Preflight (automatic, before anything is created)
- **Lock:** exclusive lock `$TMPDIR/r2b6.lock` (`mkdir`, atomic). If it already exists, the script STOPs and leaves it untouched.
- **No other Keychain test running:** `r2b_isolated.zsh` and `r2_verify.zsh` must be absent.
- **No UI-automation process:** `cua_node` / `Codex Computer Use` must not be running. You must also answer `y` to "Is Codex Computer Use (and every other UI-automation agent) switched OFF?".
- **Fresh resources:** a new private temp directory (`mktemp -d`, 0700) and a new keychain `r2b6.keychain-db`. The path is asserted and must not pre-exist. The keychain password is random, never shown, and cleared from memory.
- **Settings and item:** settings are asserted to be exactly `timeout=3600s`. **Exactly one** synthetic item `r2b6acct/R2B6-ITEM` is created with `-T ''` and a fresh random 40-character value (stdin only; never printed or logged).
- **Initial checks:** the initial ACL must be `applications (0)`, and the search list and default keychain must equal their starting values.
- **No prior Allow or Always Allow;** no other read happens before the test.

## Test
1. The script shows: **"Two Keychain authorization dialogs may appear. Click DENY on every dialog. Never click Allow or Always Allow. Do not type any password."** You press Enter.
2. Two readers `( reader a ) &` and `( reader b ) &` launch back to back. Each runs `security find-generic-password -a r2b6acct -s R2B6-ITEM -w <throwaway>` and records, in its own owner-only file, **only** its own PID, start and end time, exit code and `secret_returned=yes/no`.
3. The parent reaps each reader individually (`wait PID`, giving its exit status). It then **logs both results before asking you anything**, so a later STOP can't lose them. It cross-checks:
   - slot ↔ file;
   - reader self-PID ↔ launched PID;
   - recorded rc ↔ `wait` status.
   - It logs the start gap and whether the two reads **overlapped in time**, plus the ACL after.
4. **Separate validated questions** (each accepts only the listed characters; anything else STOPs, and the input is never logged, only its length):
   - "How many Keychain dialogs appeared? Enter 0, 1, or 2:"
   - "Did you click DENY on every dialog that appeared? Enter y or n:"
   - "Did every dialog name the application "security"? y/n/-"
   - "Did every dialog name the item R2B6-ITEM (or this test keychain)? y/n/-"
   - "Did any dialog ask for your Mac LOGIN password (not a keychain password)? y/n"
   - "Could you tell the two dialogs apart? y/n/-"

## Classification (printed as `R2B6 VERDICT:`)

| Outcome | Condition |
|---|---|
| **PASS** | 2 dialogs, all denied, both readers `rc≠0`, neither returned the secret, the reads overlapped, ACL still `(0)`, search list and default unchanged, no login-password request, dialogs named `security` and the item |
| **FAIL (security finding)** | a secret returned although you denied every dialog; the ACL changed; the search list or default changed |
| **STOPPED (security finding)** | a dialog asked for the Mac login password, or named an unexpected app or item |
| **INCONCLUSIVE** | fewer than 2 dialogs; not all denied (with no secret returned); a reader result missing; attribution or exit-code mismatch; no overlap; any `rc=0` without the secret |
| **STOPPED** | invalid input; interrupted; the lock is held |

**A missing answer is never treated as confirmation.**

## Cleanup (on every exit path, idempotent)
1. Kill and reap only our own recorded reader subshells: each must be a child of this script, checked via `ps -o ppid`. Their `security` children are killed too.
2. `delete-keychain` the throwaway file only.
3. Remove only the two reader files and the temp directory.
4. Release the lock **only if this run created it**.
5. Verify the file and directory are gone and the search list and default are unchanged.

The result is `CLEANUP: VERIFIED` or `CLEANUP: UNVERIFIED - HOLD`, the latter with manual recovery guidance and no broader deletion.

## Owner run (only after explicit approval)

**Preflight:**
- Codex Computer Use **OFF**, ChatGPT and Codex quit.
- Use **Terminal.app**.
- Keep focus on each dialog. **Deny** both. Type no password anywhere.

```bash
shasum -a 256 ~/Desktop/Claude/auraschedule-math-core/AURA_GOV_02_R2B6/r2b6_concurrency_retest.zsh
```

```bash
zsh -f ~/Desktop/Claude/auraschedule-math-core/AURA_GOV_02_R2B6/r2b6_concurrency_retest.zsh
```

**Report:** the `R2B6-1 RESULT a/b`, concurrency, `R2B6-2 OWNER`, `R2B6 VERDICT` and CLEANUP lines, plus the log path. Never a password.
