# R2D-03: Tier 2 Test Matrix (DESIGN ONLY; execution needs separate owner approval)

## Common rules for every test
- **Throwaway resources:** a fresh throwaway keychain per test group, created by the harness after Tier 1 preflight.
- **Synthetic values only:** item A `-T ''`; item B default ACL (L6 only).
- **Owner input:**
  - the owner types the **synthetic** passphrase only at tty prompts or into dialogs that ask for **this keychain's** password;
  - **never** the login password;
  - **never** Always Allow, except in L10.
- **Probe:** before and after every action (once L1 has validated one). Until then, the state is recorded as "by construction".
- **Functional oracle (fallback if L1 finds no probe):** an item-B read is **silent when unlocked** and raises an **unlock dialog when locked** (owner Cancel). Synthetic values only. This lets L7–L10 proceed.
- **Settings:** `set-keychain-settings` always gets **both `-l` and `-t N`** (each call replaces both settings). The exact `show-keychain-info` output is verified.
- **ACL checks for L2–L5:** because ACL reads are only allowed while unlocked (T1-2), each test group ends with a **controlled unlock** (owner passphrase at tty), then an ACL read, then a lock. This deliberately changes the lock state and is logged.
- **Owner actions:**
  - L6(c): Cancel the unlock dialog.
  - **L10: click Always Allow only if exactly one dialog is visible and it names the throwaway item and keychain;** otherwise Cancel all and STOP.
  - Any dialog offering **"remember password in keychain"**: record it, **never tick it**.
- **Evidence (logged before any question):**
  - step ID, UTC timestamps (`EPOCHREALTIME`), PIDs, `rc`;
  - `secret_returned` / `secret_in_output` (yes/no only);
  - probe result, ACL + identity, `mdat`;
  - **owner observations as validated tokens:** dialog count, dialog type (U = unlock-keychain dialog, A = item-access dialog, O = other), password asked (k = this keychain, l = login, n = none), action taken.
- **Global STOP:**
  - a secret returned or disclosed where Deny / Cancel / locked was expected;
  - the ACL changes outside L10;
  - any login-password dialog;
  - the search list or default changes;
  - an unexpected dialog (owner answer `X`);
  - a probe disagrees with the known state.
- **Cleanup:** R2D-07 after every test group. Verdicts per test are PASS, FAIL, INCONCLUSIVE or STOPPED.

| ID | Test | Prerequisites | Procedure (summary) | Expected observation (to be confirmed) | PASS | FAIL | STOP / INCONCLUSIVE |
|---|---|---|---|---|---|---|---|
| **L0** | Setup and baseline | Tier 1 GO | create (tty or stdin passphrase), settings `-l -t 3600`, add items, ACL with identity, **lock** | item A `(0)`; search list unchanged | all baseline checks hold | — | any T1 check fails: NO-GO |
| **L1** | Non-mutating lock-state probe (D-B1) | L0 | For each candidate probe P ∈ {`show-keychain-info <kc>`, `find-generic-password -a … -s …` (attributes, **no `-w`**), `dump-keychain <kc>` (no `-d`)}: run P with a 10 s timeout in a **known-locked** state, then again after a controlled unlock (**known-unlocked**). Record rc, output class and owner "dialog?" answer. After each run, verify the state unchanged (by the other known-good method, or by construction) | at least one P returns **different, deterministic** results for locked vs unlocked, with **no dialog** and **no state change** | a probe found that's deterministic across 3 repetitions per state, without dialogs | — | none qualifies: **INCONCLUSIVE**, and lock state stays unverifiable (RC-4 stays open; production NO-GO on D-B1) |
| **L2** | Read while locked | L0, locked (probe) | `find-generic-password -w` item A. Owner **Cancel/Deny** on whatever dialog appears; record the type (U/A) | an **unlock** dialog (type U, asks k); `rc≠0`; no secret; still locked | no secret; still locked; ACL `(0)` | a secret returned **without** passphrase entry | a login password requested: STOP |
| **L3** | Bulk dump while locked | L0, locked | `dump-keychain -d <kc>`. Owner Cancel/Deny on **every** dialog; count them | ≥ 1 unlock dialog; no secret in output; still locked | no secret; still locked; ACL unchanged | a secret in output without passphrase entry | — |
| **L4** | Overwrite and delete while locked | L0, locked | (a) `security -i` `add-generic-password -U` with a **different synthetic** value for item A; owner Cancel. (b) `delete-generic-password` item A; owner Cancel. After each: attributes and `mdat` (if readable by a validated probe) | each requires the passphrase; fails on cancel; item present; `mdat` unchanged | both fail; item unchanged | the overwrite or delete succeeds without the passphrase | `mdat` unreadable while locked: verify after a controlled unlock |
| **L5** | Concurrent reads while locked | L0, locked | two concurrent `find -w` readers (R2B-6 bookkeeping). Owner Cancel/Deny on all; count and type the dialogs | 1 or 2 unlock dialogs; both `rc≠0`; no secret; still locked | both fail; no secret; still locked | any secret | dialogs > 2 or unattributable: INCONCLUSIVE |
| **L6** | Per-read prompts vs unlocked window (D-B2) | L0 | Unlock via tty (passphrase). (a) Read item A (`-T ''`): owner **Deny**; record the dialog type and passphrase request. (b) Read item B (default ACL): record whether it was **silent**. (c) Lock; read item B: record the dialog type. Measure the unlocked-window duration | (a) an item dialog asking k; (b) silent while unlocked; (c) an unlock dialog when locked | measurements recorded (this test **characterizes**; it doesn't pass or fail the design) | — | an unexpected login-password request: STOP |
| **L7** | Crash and interruption recovery + watchdog (revised, review P1-3) | L0, probe (L1) or functional oracle validated | Unlock via tty. Launch the watchdog as its **own exec'd process** with a short argv (`/usr/bin/nohup /bin/zsh -f -c 'trap "" HUP INT TERM; sleep $1; exec /usr/bin/security lock-keychain -- "$2"' r2d_watchdog $N "$KC"`); log its PID. The **observer** is a separate hash-pinned `r2d_observe.zsh`, launched via the same bootstrap in a second fresh window, which checks `kill -0 <watchdog PID>`. The owner kills the harness **by its exact logged PID** (`kill -9 <PID>`, **never `pkill -f`**). The observer probes at t+5 s and t+N+10 s | t+5 s: unlocked (expected residual); t+N+10 s: **locked** via the watchdog | locked by t+N+10 s | still unlocked after the deadline | probe/oracle unavailable or watchdog not alive before the kill: INCONCLUSIVE. **Post-L7 cleanup is the manual recovery** (R2D-07): the lock and temp directories remain |
| **L8** | Timeout relock | L0, probe validated **and shown not to reset the idle timer** (L1 criterion) | settings **`-l -t 60`** (both always passed; verify the exact `show-keychain-info` string); unlock; idle; probe **only at 75 s** (a 30 s check runs in a separate repetition, with the deadline recomputed from the last access) | 75 s locked | locked by 75 s | unlocked after 75 s | — |
| **L9** | Sleep/wake relock | L0, probe validated; owner present | settings **`-l -t 3600`**; unlock; the owner sleeps the Mac (Apple menu → Sleep) ≥ 10 s, then wakes. **Exception: the macOS lock screen asking for the login password after wake is expected and is NOT a Global STOP.** Evidence of real sleep from read-only `pmset -g log` timestamps; then probe | locked after wake | locked | unlocked | no sleep evidenced: INCONCLUSIVE |
| **L10** | Isolated "Always Allow" | **Automation-off attestation re-confirmed immediately before**; L1 probe validated; fresh keychain | Unlock; read item A; owner clicks **Always Allow** (enters the synthetic passphrase). ACL with identity, which is expected to become `(1)` `com.apple.security`. Read again: expected silent. **Lock.** Read again: record whether an **unlock** dialog appears (owner **Cancel**) and whether the secret was returned. Then **destroy the keychain** | trust persists in the ACL; while **locked**, the read requires unlock; no secret on Cancel | locked + trusted read returns **no secret** without the passphrase | the secret is returned while locked without passphrase entry. **That proves locking doesn't contain an Always Allow** | an unexpected dialog: STOP |
| **L11** | ACL persistence and unexpected trusted apps (detector positive control) | L0 | Item C created **with** `-T /usr/bin/security` (synthetic); run the T1-2 detector on items A/B/C; then the final ACL sweep of all items | the detector reports A restricted; B and C OPEN with identity `com.apple.security` | the detector flags exactly B and C with the correct identity | the detector misses C | — |
| **L12** | Dialog identity and phishing distinguishability | during L2–L10 | For every dialog, the owner records: type U/A/O; whether it names `security`; whether it names the keychain or item; the password asked (k/l/n). Concurrency (L5): distinguishable y/n | unlock and item dialogs distinguishable from each other; concurrent ones not | recorded (characterization) | — | any login-password request: STOP |

**Additional tests (review P2-8):**
- **L13:** wrong passphrase and retry behaviour at the unlock prompt.
- **L14:** `unlock-keychain` on an already-unlocked keychain.
- **L15:** for a `-T ''` read while locked, the U → A dialog sequencing (the cost of D-B2(i)).
- **L16 (production-only, P3):** reboot/login auto-unlock behaviour.

**L1 criterion added:** a probe must also be shown **not to reset the idle timer**.

**What no test can establish:** protection against a compromised session or an admin (accepted limitation), or against UI automation that is present but undetected. These are covered only by attestation.
