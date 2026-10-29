# R2C: Security Properties Established (Phase D)

**Scope of all evidence:**
- macOS 14.6 on this Mac;
- **unlocked** throwaway keychains (never the login keychain), with a single `-T ''` generic-password item;
- `/usr/bin/security` as the only client;
- the owner as the only dialog operator (automation present in run 2 only).

| # | Property | Status | Evidence |
|---|---|---|---|
| 1 | **Explicit Deny** blocks disclosure (single read) | **Established** | R2B-1, R2B-3, R2B-5 (`rc=128`, no secret) |
| 2 | **One-time Allow** releases once and doesn't persist trust | **Established** | R2B-2 → R2B-3; ACL `(0)` |
| 3 | **Always Allow** persists trust; later reads are silent | **Observed effect** (run 2, owner-transcribed: `(0)`→`(1)` + silent reads); **cause (an Always Allow click) strongly supported** | R2-5b `(1)`, silent reads with `secs=0` |
| 4 | **ACL trust changes** occur through a dialog choice **or by any process holding the keychain password** (K7 partition-list); not via `add -U -T` or `-A` without it | **Established** for the tested commands | K6/K7 (rotation plan §13); R2B/R2B-6 ACL unchanged |
| 5 | **Bulk dump** (`dump-keychain -d`) raises dialogs and doesn't disclose when they're denied | **Established** (4 dialogs; exits 0) | R2B-4 |
| 6 | **Concurrent reads** are each gated; both denied means both fail | **Established** | R2B-6 |
| 7 | **Prompt identity:** dialogs name `security` and the item | **Established** (owner-reported) | R2B-1…6 |
| 7a | **Concurrent prompts are indistinguishable** | **Established** (owner) | R2B-6 `distinguishable=n` |
| 8 | **Password prompts:** for a non-login keychain, **each observed single-read dialog** requested **that keychain's password** | **Supported (owner-reported, n=1 run, unlocked throwaway keychains)** | **Primary:** R2B-1…5 `password_requested=t`, including R2B-3 right after R2B-2's password entry (no caching); R2B-2 Allow needed it; run-2 owner facts. Thinner: R2B-6 `keychain_password_requested=y` (at least one of two); R2B-4 one answer for four dialogs. **Discrepancy:** run `071207Z` stopped on an owner answer of "login password" (reconciled only as probable wording ambiguity, UNVERIFIED). **Re-measure when locked** (unlock + ACL prompts may double) |
| 8a | Dialog behaviour for **login-keychain** items with `-T ''` | **UNVERIFIED** (never tested; the current launcher design uses the login keychain) | — |
| 9 | **Keychain lock state** effects on reads, dumps and dialogs | **UNVERIFIED** (all tests unlocked; lock state isn't queryable by CLI without side effects) | — |
| 9a | Writes to a **locked** keychain need its password (prompt; fail if cancelled) | **Partly established** (reviewer, throwaway) | R-2 review |
| 10 | **Process boundaries:** a same-user process can't silently **read** a `-T ''` item while the ACL is `(0)`; it **can** silently overwrite or delete it | **Established in unlocked throwaway keychains** (read: K3, R2B; write/delete: K4/K5). **Expected, UNVERIFIED** for the login keychain | rotation plan §13 |

## What the experiments do **not** establish
- **Always Allow:** protection after "Always Allow" is granted. The item is then open to **any** caller of `/usr/bin/security`.
- **Existing trust:** protection if `security` is already trusted, through an earlier grant or Keychain Access.app edits.
- **Locked state:** behaviour while the keychain is **locked** (reads, dumps, dialogs, trusted-app reads) is **untested**.
- **Unlocked state:** **no** protection against overwrite or delete, or against a mistaken approval.
- **Other processes:** protection against another process invoking the trusted executable once trust exists.
- **Privileged access:** protection against a **privileged local actor** (root or an admin with the keychain password), who can read the keychain file plus its password **offline**, or attach to processes.
- **Automation:** protection against **automation tools** with Accessibility, which may be able to act on dialogs. Untested by design; run 2 is consistent with it.
- **A compromised Mac or user session**, keyloggers, or **spoofed dialogs** that harvest the keychain password.
- **Scope limits:** behaviour on other macOS versions, the login keychain, iCloud, Time Machine copies, or multiple items.

**Do not infer broader system security from these tests.** They establish that a restricted item resists unauthorized reads **when every authorization dialog is denied by an attentive human** on an uncompromised session.
