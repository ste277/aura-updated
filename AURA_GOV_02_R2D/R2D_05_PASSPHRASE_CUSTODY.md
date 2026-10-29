# R2D-05: Passphrase Custody Procedure

## Prototype (synthetic passphrase)
1. **Generation:** the owner invents a **throwaway** passphrase at test time: lowercase words separated by single spaces (`^[a-z]+( [a-z]+)*$`). It must **not** equal the login password or **any real password**. It's never reused, never stored in a password manager, and never written to any file. **No tool generates it.**
1a. **Terminal → Secure Keyboard Entry ON** during any tty entry.
2. **Entry points (only these):**
   - (a) the tty prompt of `security create-keychain` / `unlock-keychain` (echo off), or the fallback harness `read -s </dev/tty`, passed via `security -i` stdin;
   - (b) macOS dialogs that ask for **this keychain's** password (types U/A).
3. **Never:** clipboard; terminal echo; command arguments; environment; source code; logs; chat; screenshots.
4. **Disposal:** the keychain is deleted at teardown, so the passphrase becomes meaningless. The owner discards it mentally.

## Production (future; requires its own approval)
1. **Generation:** a password-manager-generated passphrase, ≥ 128 bits. **Typeable** form recommended (e.g. 10 diceware words), so manual entry avoids the clipboard.
2. **Storage:** the password manager only. **Not** in the login keychain (no circularity).
3. **Retrieval and entry, in order of preference:**
   - (a) the owner reads it from the password manager and **types** it at the tty prompt;
   - (b) password-manager **auto-type** (no clipboard), if supported;
   - (c) clipboard only with explicit, recorded owner acceptance (R0-class residual), clipboard managers and Handoff off, `pbcopy </dev/null` afterwards.
4. **Dialogs:** type it only into a dialog that appears **at an announced step** and names this keychain. Any other dialog: Cancel and STOP (phishing control, RC-11).
5. **Recovery:** a lost passphrase means the stored DB credential is unrecoverable. **Recovery = a fresh credential rotation** (an authorized B2-B-R repeat). No backup copy of the passphrase outside the password manager.
6. **Rotation of the passphrase:** `security set-keychain-password <path>` (interactive). The procedure is **UNVERIFIED**; validate it in a separate test.
7. **Dependency chain (recorded):** DB credential ← dedicated keychain ← passphrase ← password manager ← owner account. The password manager must not depend on the dedicated keychain.
8. **Backups:** the keychain file appears in Time Machine; protection rests on the passphrase strength. Exclusion from backups is an owner decision.
