# R2B6: Non-interactive Self-Test Results (2026-11-12)

**Method:**
- The script's own `--selftest=<case>` mode replaces **only** the two `security find-generic-password` reads with mock readers (sleep + exit code ± synthetic value). Everything else is real:
  - the throwaway keychain is created, its ACL checked and the keychain deleted;
  - the search list and default are checked;
  - the lock, PID bookkeeping, `wait` statuses, logging and cleanup all run.
- **No real Keychain read; no authorization dialog possible.**
- The prompts were driven through a pseudo-terminal (`script`), including Ctrl-C.
- After every run the harness checked:
  - no 40-character alphanumeric token in the log (secret redaction);
  - the typed test password absent from the log;
  - no `r2b6.*` temp directory left, the lock released;
  - no script or mock (`sleep 60`) process left;
  - the user search list and default keychain unchanged.
- **Harness note:** the `nolog` strings and the "no matches found" glob warnings in the raw output are artefacts of my harness (`grep -c` with 0 matches). All counts were 0.

| # | Case | Input | Result | Expected | Post-checks |
|---|---|---|---|---|---|
| T1 | both denied | Enter, `2`, `y`, `y`, `y`, `n`, `n` | both `rc=128 secret_returned=no`, `wait_rc` equal, overlap yes (gap 0.001 s) → **PASS** | PASS | all clean |
| T2 | reader a returns the secret | same | a `rc=0 secret_returned=yes` → **FAIL (secret returned although every dialog was denied)**, SECURITY FINDING stop | FAIL | all clean; **secret not in log** |
| T3 | reader b `rc=0` without the secret | same | **INCONCLUSIVE** (`rc_b=0`) | INCONCLUSIVE | all clean |
| T4 | combined answer `2 y` (the original defect) | Enter, `2 y` | reader results **logged before the prompt**; `STOP: INVALID input (len=3) - not logged` (on screen and in the log) → **STOPPED (invalid owner input)** | STOP; results preserved | all clean |
| T4b | invalid input at the Enter prompt | `x` | STOP shown; CLEANUP and VERDICT shown | STOP | all clean |
| T5 | only 1 dialog | Enter, `1`, … | **INCONCLUSIVE (dialogs=1)** | INCONCLUSIVE | all clean |
| T6 | Ctrl-C while readers run (`hang`: readers sleep 60 s) | Enter, Ctrl-C | `interrupted - click Deny on any dialog still open`; readers killed and reaped (`sleep60_left=0`) → **STOPPED (interrupted)**, `CLEANUP: VERIFIED` | STOP + verified cleanup | all clean |
| T7 | password typed into a prompt | `MyPassw0rdTyped` | `INVALID input (len=15) - not logged` → STOPPED | STOP, not logged | **typed password absent from log** |
| T8 | stray type-ahead during the reads | `zzz` typed while readers ran, then valid answers | type-ahead flushed → **PASS** | PASS | all clean |
| T9 | owner reports a login-password dialog | …, `y` at the login question | **STOPPED (login password requested - security finding)** | STOP | all clean |
| T10 | lock already held | Enter | `STOP: another R2B6 run holds … r2b6.lock`; **pre-existing lock left intact** | STOP, the other run's lock untouched | the harness removed its own lock afterwards |

**Defects found and fixed during self-testing:**
1. An invalid-input STOP inside `$(…)` was written only to the log, not the screen, and the verdict said just "STOPPED". Now the STOP prints to the terminal and the verdict is `STOPPED (invalid owner input)` (T4, T7).
2. An invalid input at the Enter prompt suppressed the CLEANUP and VERDICT lines on screen. Fixed (T4b).

**Also verified:**
- evidence logs are created **owner-only** (`-rw-------`, umask 077);
- `zsh -n` passes.

**Not covered by self-tests (by design):** real authorization dialogs and macOS behaviour. That is the purpose of the owner-run interactive test.

## Re-run after the independent review (final script `e7e7efa6…a335c`, 155 lines)

**Changes:**
- EOF (Ctrl-D) and whitespace-only input are no longer accepted (`IFS= read`, and EOF means STOP);
- PASS requires `rc_a = rc_b = 128` **and** both dialogs naming `security` and the item;
- per-reader **non-secret** `stderr_class` (`canceled` / `denied` / `other` / `none`; `mock` in self-tests);
- new owner question about a keychain-password request;
- macOS version logged;
- preflight requires ≥ 500 MB free on the home volume;
- warning if the log didn't record the verdict;
- mode-label fix.

| # | Case | Input | Result |
|---|---|---|---|
| U1 | both denied | Enter, `2`, `y`, `y`, `y`, `n`, `y`, `n` | **PASS**; owner line `dialogs=2 all_denied=y app_security=y item_expected=y login_password_requested=n keychain_password_requested=y distinguishable=n` |
| U2 | leak | same | **FAIL** (secret returned although every dialog was denied); secret not in log |
| U3 | `rc=0` without the secret | same | **INCONCLUSIVE** (`rc_b=0`; "PASS needs 2/y/128/128/1/y/y") |
| U4 | **Ctrl-D at the launch prompt** (review P1) | EOF | `STOP: no input (EOF) - not treated as confirmation`; **no reads launched**; STOPPED |
| U5 | whitespace-only "Enter" | three spaces | `INVALID input (len=3)`; STOPPED; no reads launched |
| U6 | `-` for "dialog named security" with 2 dialogs (review P2) | … `-` … | **INCONCLUSIVE**, no longer PASS |
| U7 | Ctrl-D at the dialog-count prompt | EOF | STOP (EOF); reader results already logged |
| U8 | Ctrl-C during reads | Ctrl-C | interrupted; readers reaped; `CLEANUP: VERIFIED` |
| U9 | Ctrl-D at the keychain-password question | EOF | STOP (a missing answer is never confirmation) |
| U10 | combined `2 y` (the original defect) | `2 y` | STOP; **reader results logged first** |

**Post-checks for every case:**
- 0 forty-character tokens in the log;
- typed password absent;
- no temp directory left, the lock released;
- no processes left;
- search list and default keychain unchanged;
- logs `-rw-------`.

**Not exercised by mocks:** the real `security` stderr text used for `stderr_class` (it holds error messages only, never the secret, and is deleted immediately). The real dialogs are exercised only by the owner run.

**Note:** the self-tests and review left about 32 mock logs (0600, sanitized) in `~/aura-r2b-evidence/`. The owner may delete `r2b6-*-mock-*.log`. The disk had **2.1 GiB free** at the end. The script's preflight requires 500 MB.
