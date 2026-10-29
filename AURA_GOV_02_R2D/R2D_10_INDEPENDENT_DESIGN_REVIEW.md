# R2D-10: Independent Design Review (fresh context, AI)

- **Verdict: CONDITIONAL GO** for harness **implementation** (mock-only self-tests). **NO-GO for execution** until the items below are implemented and re-reviewed.
- No P0.
- **R2D doesn't overclaim on locked-keychain security**, except for the original RC-24 "design complete" wording, which is now corrected.

**The reviewer's method:**
- read-only, plus dummy-zsh experiments on the bootstrap in a scratch directory (since removed);
- **no `security` command**, no keychain, TCC, network or production access.
- `security` behaviour was checked against `man security` only.

## Findings and dispositions

| ID | Sev | Finding (reviewer-verified where noted) | Disposition |
|---|---|---|---|
| P1-1 | P1 | The bootstrap's `&& … \|\| echo MISMATCH` printed **"HASH MISMATCH - not executed" after the harness had run** whenever it exited non-zero (STOP 2, interrupt 130, L7 `kill -9` 137). **Verified** | **Fixed in R2D-06:** `if …; then run; print rc; else MISMATCH; fi` |
| P1-2 | P1 | Process-list self-match: with `zsh -c "$S"` the script text is the argv of every forked subshell, so `pgrep -f` matched the harness's own watchdog. This gives a false NO-GO in T1-6, makes the L7 `pkill -f` also kill the watchdog, and means R2D-07 watchdog identification could never match. **Verified** | **Fixed:** T1-6 matches executable names via `ps -axo pid=,ppid=,comm=`, excluding the harness and its children; the watchdog is its own exec'd process with a short argv (`r2d_watchdog N path`); L7 and recovery use the **exact logged PID** only |
| P1-3 | P1 | L7 couldn't be measured (no observer after the kill; watchdog detachment unspecified; killing a "test child" proves nothing) | **Fixed in R2D-03 L7:** `nohup` watchdog ignoring HUP/INT/TERM; a hash-pinned observer `r2d_observe.zsh` in a second window; `kill -0` watchdog check before the kill; exact-PID kill; post-L7 = manual recovery |
| P1-4 | P1 | RC-24 overstated. **TOCTOU closed (verified)**, but the bootstrap itself is subvertible by same-user persistence: `PERL5LIB`/`PERL5OPT` into the Perl-based `/usr/bin/shasum`, `alias /bin/zsh`, `print` functions, rc files and ZLE. **Verified** | **Fixed:** `env -i shasum`, `builtin print`, a fresh `env -i … zsh -f` window (to be verified), NUL/CR rejection; RC-24 = "design complete, residual mapped to RC-18, not closed" (R2D-04, R2D-06) |
| P2-1 | P2 | `set-keychain-settings` replaces both settings on every call | **Fixed:** always `-l -t N` and verify the exact string (R2D-03) |
| P2-2 | P2 | An empty `$KC` would make `unlock/lock/set-keychain-settings` target the **login keychain** | **Fixed:** new **T1-8** path guard with a mock `KC=''` self-test (R2D-02) |
| P2-3 | P2 | T1-3 fallback self-contradictory; `security -i` tokenization of a passphrase unspecified | **Fixed:** a charset restriction, `builtin print -r` into the pipe as the single permitted use, output to /dev/null, Secure Keyboard Entry (R2D-02/05) |
| P2-4 | P2 | ACL reads only while unlocked vs the L2–L5 ACL PASS criteria | **Fixed:** an end-of-group controlled unlock → ACL → lock, logged (R2D-03) |
| P2-5 | P2 | Probes may reset the idle timer (a false L8 FAIL); no fallback if L1 fails | **Fixed:** L1 adds a "doesn't reset the idle timer" criterion; L8 probes only at the deadline; a functional oracle (item-B silent vs unlock dialog) |
| P2-6 | P2 | L9 lock screen vs the Global STOP on a login password | **Fixed:** an explicit exception; sleep evidenced by `pmset -g log` |
| P2-7 | P2 | Owner actions unspecified (L6(c), L10 multi-dialog) | **Fixed:** Cancel in L6(c); L10 Always Allow only with exactly one dialog naming the item and keychain; never tick "remember password" |
| P2-8 | P2 | Missing tests: "remember password" option, wrong passphrase/retry, double unlock, U→A sequencing, reboot auto-unlock | **Added:** L13–L16 + the recording rule |
| P2-9 | P2 | T1-6 coverage: more processes; Sharing settings; Terminal in Accessibility; exact `csrutil` string | **Fixed:** extended list; Sharing attestation; **T1-9** exact SIP line |
| P2-10 | P2 | Custody: Secure Keyboard Entry; not a real password; charset | **Fixed** (R2D-05) |
| P2-11 | P2 | Owner checklist gaps | **Fixed** (R2D-08: R2D-03/RD-1…4 approval, quit Claude, Sharing, fresh window, exact-PID kill, L9 exception, post-L7 recovery) |
| P3 | P3 | `-d system` domains; recovery glob vs lock directory; RD-1 vs L11; NUL truncation; `$ZSH_EXECUTION_STRING` is evidence, not control (UNPINNED under `--selftest`); R2D-04 wording (RC-17, RC-23, D-G2, "reduces"); `security -i` output to /dev/null | **Fixed** across R2D-02/03/04/06/07 |

**Verified fine by the reviewer:**
- trailing-newline preservation (the hash equals `shasum` of the file);
- a wrong or empty hash refuses to execute;
- post-read file replacement has no effect;
- no `!` history-expansion risk; correct quoted comparison;
- a non-zsh shell fails closed;
- ARG_MAX is ample;
- `create-keychain` without `-p` prompts on the tty (man page);
- R2D-04 covers RC-1…24 consistently; no P1 is falsely closed;
- RC-18 is stated as an accepted limitation;
- the D-B2 trade-off is faithful; "locking is not assumed until measured" is upheld;
- prototype and production are separated;
- the R2D-07 reaping and `rmdir` discipline holds;
- the checklist separates implementation from execution.

**Agreement with the recommendation:**
- **CONDITIONAL GO for implementation:** agreed.
- **Execution stays NO-GO** until the implemented harness passes its mock self-tests (including the fresh-window rc-bypass verification, the T1-8 `KC=''` NO-GO, the bootstrap marker tests and the process-list exclusion) and a fresh independent review.
