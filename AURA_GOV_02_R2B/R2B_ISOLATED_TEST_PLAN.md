# R2B: Isolated Test Plan (PREPARED, NOT EXECUTED; requires explicit owner approval)

**Script:** `AURA_GOV_02_R2B/r2b_isolated.zsh`, 140 lines, sha256 `72d13e72318f5ca52ad47545eabf04087b594b1ec38f019d3104b59b15a91430` (revised after the independent review; supersedes `a24edb2d…`).

**Self-test (non-interactive; no read, no dialog) was run by Claude on 2026-11-12:**
- setup OK;
- ACL `applications (0)`;
- guards OK;
- **cleanup VERIFIED** (file and temp directory removed, search list and default keychain unchanged; independently re-checked);
- sanitized log `~/aura-r2b-evidence/r2b-20261112T065728Z-selftest.log`.

**Separately:** the ACL parser reports the trusted application's **identity** for an OPEN item (`applications (1): | requirement: identifier "com.apple.security" and anchor apple`).

## Phase D preflight: confirmations (from code inspection)

| Requirement | How it's enforced |
|---|---|
| Can't target login, system or Production keychains | Every `security` call passes the explicit throwaway path `$KC`. The path is asserted to match `$TMPDIR/r2b.*/r2b-isolated.keychain-db` and must not pre-exist. No call uses the search list |
| Can't access Aura Production credentials | No reference to `aura_app_2026_11`, `AURA-Neon-*`, the login keychain, the network, psql or Neon |
| Unique disposable resources | `mktemp -d` (0700); a new keychain file; a random 6-character dummy keychain password per run |
| Synthetic secret not reused | 40 fresh random `[A-Za-z0-9]` characters from `/dev/urandom` per run; never printed; held only in shell memory |
| Cleanup limited to its own resources | `delete-keychain "$KC"`, `rm -f "$KC"`, `rmdir "$D"`. Nothing else. Self-verified, and printed as VERIFIED or UNVERIFIED |
| Never changes the default keychain or search list | No `default-keychain -s` / `list-keychains -s` calls. Both are **compared to the baseline after every step** (STOP on change) and at cleanup |
| No existing item or ACL can be modified | Only the synthetic item in the throwaway keychain is created. No `-U`, no `set-*-partition-list`, no ACL edits. **No "Always Allow" step** |
| No real secrets in logs | The log holds only step results, timings, owner answers, ACL lines and settings. Dummy keychain password: printed to the terminal for the owner (it is not a secret) |

## Sequence (the owner presses Enter before each step and records what happened)

| Step | Action | Owner does | Expected | STOP if |
|---|---|---|---|---|
| R2B-0 | baseline: path, item identity (exactly 1), settings (`timeout=3600s`, no lock-on-sleep), ACL, search list and default | — | ACL `applications (0)` | anything else |
| R2B-1 | single read | **Deny** | `rc≠0`, no secret, owner=D | secret returned |
| R2B-2 | single read | throwaway password if asked, **Allow** | `rc=0`, secret returned, owner=A; ACL still `(0)` | ACL changes |
| R2B-3 | repeat single read | **Deny** | a dialog appears; no secret | secret returned (persistent Allow) |
| R2B-4 | **bulk dump** `dump-keychain -d` (exact original command) | if a dialog appears: **Deny**; report the count | `secret_in_dump=no`; ACL `(0)` | secret in dump (silent bulk access) or ACL change |
| R2B-5 | post-dump single read | **Deny** | a dialog appears; no secret | secret returned |
| R2B-6 | two concurrent reads | **Deny every dialog**; report the count | both `secret_returned=no`; ACL `(0)` | any secret returned |

**Owner input:** pending type-ahead is flushed before each question, and only single validated tokens are accepted (`D/A/N/X`, `y/n/-`, `n/t/l`, a digit, `"n y"`). **Anything else, e.g. a password typed into the terminal by mistake, is never logged** (only its length) and STOPs. Per step, the owner also records whether the dialog named `security`, whether it named `R2B-ITEM`, and whether it asked for a password (throwaway / login). A **login**-password request STOPs.

The script also stops if:
- **N with a dialog expected** at R2B-1/2/3/5: INCONCLUSIVE (the run-1 pattern);
- **Allow at a Deny step**, Deny at the Allow step, or **Allow that returns no secret** (R2B-2);
- R2B-4: **N + secret** (dump bypasses the ACL), **D + secret** (Deny not honoured, or another dialog answered), or X. **N + no secret** is recorded as a note;
- R2B-6: more than 2 dialogs, or not all denied;
- the owner answers **X** (any unexpected event);
- the ACL leaves `applications (0)`;
- the search list or default keychain changes.

Sub-second timings are recorded (`EPOCHREALTIME`).

## What each outcome means

- **R2B-4 shows a dialog and no secret:** the bulk dump respects the ACL prompt. The run-2 `secret_in_dump=1` was a granted dialog, which confirms hypothesis (A) in the audit.
- **R2B-4 shows the secret with no dialog (STOP):** bulk dump bypasses the ACL. That's a **design-breaking finding**: `-T ''` would not protect against `dump-keychain -d`.
- **R2B-6 dialog count:** 0 with no secret means the requests were refused or cancelled; 1 means serialized; 2 means as run-1 instructions assumed. The count is recorded, not assumed.

## How to run (only after explicit owner approval)

**Preflight:**
- No screen-control or Accessibility agents active: Codex Computer Use **OFF**, ChatGPT quit.
- Keep focus on each dialog. Never type a password into the terminal.
- On Ctrl-C the script kills its R2B-6 readers; **Deny any dialog left open**.
- Run in **Terminal.app**, not the Claude app's input box.
- Verify the file first: `shasum -a 256 ~/Desktop/Claude/auraschedule-math-core/AURA_GOV_02_R2B/r2b_isolated.zsh` must equal the hash above.

```bash
zsh -f ~/Desktop/Claude/auraschedule-math-core/AURA_GOV_02_R2B/r2b_isolated.zsh
```

**Report:** the `R2B-*` RESULT lines, the CLEANUP line and the log path. Never a password.
