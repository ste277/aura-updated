# R2B: Dedicated Locked-Keychain Alternative (DESIGN ONLY; not implemented)

## Proposal

- **Dedicated keychain:** `~/Library/Keychains/aura-rot.keychain-db`, with its **own password** stored in the owner's password manager (not the login keychain).
- **Settings:** `set-keychain-settings -l -t <longer than the maximum run time>` (lock on sleep), plus an **explicit `lock-keychain` in `finalize`**. A short timeout could relock mid-run and add unlock dialogs. **Not** in the search list.
- **Items:** `-T ''` (no trusted applications), so even while unlocked every read needs a dialog.
- **Run window:**
  - the launcher checks the keychain is **locked** at start;
  - it unlocks it interactively with `security unlock-keychain <path>`. With no `-p`, this prompts on the tty, so no argv or env exposure;
  - it locks it with `security lock-keychain <path>` in `finalize`, on every path including interrupt;
  - `ROT FINAL` adds `keychain_locked=yes`.

## Evaluation

| Question | Assessment | Status |
|---|---|---|
| Explicit unlock required? | Yes. While locked, any operation needs the keychain password. Reviewer-measured: a write to a locked keychain ended `User canceled`, i.e. **it requires the keychain password and fails if the unlock prompt is cancelled**. Note: in a GUI session **any same-user process can trigger a genuine unlock dialog** at any time | Write behaviour: measured as "prompt then cancel". Reads while locked: **UNVERIFIED** |
| Does an **unlocked** keychain allow silent retrieval via the tested commands? | Not with `-T ''` and ACL `(0)`: a single read prompts (R2-1/R2-3). **Bulk dump: UNVERIFIED (R2B-4).** **After any "Always Allow": yes, silent for every `security` caller** | Partly verified |
| Lock immediately after the authorized retrieval | Yes: `lock-keychain` in `finalize` and after the last readback. The exposure window is the unlock period (seconds to a minute) | Design |
| Bulk dumps while locked | Expected to require the keychain password (prompt or failure) | **UNVERIFIED**: add as R2B-7 in a follow-up locked-keychain test |
| Concurrent reads while locked | Expected: each prompts for the keychain password, or fails | **UNVERIFIED** |
| Can the rotation launcher do 2 verified readbacks safely? | Yes: unlock once → write PENDING → readback (dialog 1, Allow) → ALTER/validate (in memory) → write LIVE → readback (dialog 2, Allow) → delete PENDING → **lock**. That's 2 item dialogs plus 1 unlock prompt | Design |
| Can an external `security` process access the secret during the unlock window? | **Yes, if it fires a read and the owner clicks Allow on its indistinguishable dialog**, or if "Always Allow" was ever granted. Without a granted dialog, no. Silent **overwrite** is also possible while unlocked | Residual (user-mediated) |
| Temporary plaintext files, logs, argv | None by design: the value is in memory; `security -i` takes it on stdin; psql gets it on stdin (no FIFO since the P1-A fix); the unlock password is typed at a tty prompt. The keychain file itself is encrypted | Design (as tested for the current launcher) |
| Is another access-control design needed? | To **reduce dialogs to zero during rotation**: generate in memory, keep the value in memory for ALTER and validation, and **verify the stored copy only at Phase C**, with one read from a locked, dedicated keychain. Fewer dialogs means fewer chances to misattribute one. Alternatively, store the credential **only** in the owner's password manager via a non-clipboard path (not available on macOS without vendor CLI or autotype; out of scope) | Recommendation |

## Comparison

| Property | Login keychain + `-T ''` (current) | Dedicated locked keychain + `-T ''` |
|---|---|---|
| Silent read at rest | prevented (unless Always Allow) | prevented, and also needs the keychain password while locked |
| Silent overwrite or delete at rest | **possible** (K4/K5) | overwrite **requires the keychain password** (unlock prompt; fails if cancelled); delete or replace of the **file** still possible (detectable) |
| Effect of a mistaken "Always Allow" | **permanent** silent access for all `security` callers | expected: silent only while unlocked (while locked, an unlock dialog would appear). **UNVERIFIED.** Still a persistent ACL change (must be checked) |
| Owner friction | 2 dialogs per rotation | 2 dialogs + 1 unlock prompt |

**Additional risks (both designs):**
- **Offline decryption and backups.** File-keychain ACLs are enforced by `securityd`, not by the encryption. The keychain file plus its password decrypts every item offline. Copies exist in Time Machine and other backups, so the dedicated keychain's password must be **strong and random** (password manager). Either exclude the file from backups or accept the risk.
- **Password phishing and spoofed dialogs.** A non-login keychain's Allow and unlock dialogs ask for that keychain's password, so every readback trains the owner to type it into GUI dialogs. A same-user process can raise genuine unlock or Allow dialogs, or imitate them.
- **Keychain Access.app** can display the password, change Access Control ("allow all applications") and add the keychain to the search list. Don't open it for these items; the `ROT FINAL` ACL check stays mandatory.
- **iCloud:** file-based keychains are not synced by iCloud Keychain (per Apple's documentation; **UNVERIFIED here**). Evidence logs live in `~/aura-r2b-evidence` (sanitized). The repo is on `~/Desktop`, which may be synced if Desktop & Documents sync is on (sanitized documents only).
- **Terminal type-ahead:** a password typed while a dialog lacks focus lands in the terminal. Mitigated in the R2B script (flush plus validated tokens, never logged); the launcher would need the same treatment.

**Conclusion (design):** the dedicated locked keychain strictly improves at-rest confidentiality and integrity, and limits the damage of a mistaken Always Allow to unlock windows. It doesn't remove the user-mediated dialog risk during the window. **It is recommended**, and it must be validated by an extended isolated test (R2B-7…: locked reads, locked dump, locked overwrite, unlock/lock cycle) before adoption. **Not implemented in this ticket.**
