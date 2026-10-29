# R2D-06: Launcher Integrity and Execution-Control Design

## Problem
The R2B/R2B-6 practice was "`shasum` the file, then `zsh -f <file>`". That leaves a window in which a same-user process could replace the file after the check (RC-24, TOCTOU).

## Design: hash-then-execute-from-memory bootstrap
**Preconditions (review P1-4):**
- Run in a **fresh Terminal window started without user rc files**, via Terminal → Shell → New Command: `/usr/bin/env -i HOME=$HOME TERM=xterm-256color /bin/zsh -f`. That this actually bypasses `~/.zshenv` / `~/.zshrc` / ZLE widgets is **UNVERIFIED**; it must be verified in the implementation self-test.
- The owner then types this **bootstrap** (revised after review P1-1: the harness exit status is no longer misreported as a hash mismatch):

```zsh
H=<expected-sha256>; S=$(/bin/cat ~/path/r2d_prototype.zsh; builtin print -n x); S=${S%x}; if [[ $S != *$'\0'* && $S != *$'\r'* && $(builtin print -rn -- "$S" | /usr/bin/env -i /usr/bin/shasum -a 256) == "$H  -" ]]; then /bin/zsh -f -c "$S" r2d_prototype; builtin print -r -- "R2D BOOTSTRAP: harness exited rc=$?"; else builtin print -r -- 'R2D BOOTSTRAP: HASH MISMATCH or NUL/CR - not executed'; fi
```

- `env -i` blocks `PERL5LIB`/`PERL5OPT` injection into `/usr/bin/shasum`, which is a Perl script (review: verified).
- `builtin print` defeats a hijacking function named `print`.
- NUL and CR are rejected (a NUL hashes correctly but executes truncated; verified by the review).
- Self-test arguments, if any, go **after** `r2d_prototype` (`$0`).

- **One read, exact bytes:** the file is read **once**. The `print -n x` / `${S%x}` trick keeps trailing newlines, so the in-memory bytes equal the file bytes and the hash equals `shasum` of the file.
- **Hashed bytes are executed bytes:** the **same in-memory bytes** that were hashed are executed. The file isn't reopened, so substitution after the read has no effect.
- **Mismatch:** a mismatch means nothing executes.
- **Pinned binaries:** only SIP-protected system binaries are used (`/bin/zsh`, `/bin/cat`, `/usr/bin/shasum`). The harness records `csrutil status` and requires it to be enabled (T1-5).
- **Self-contained harness:** it sources no other file. It embeds no external hashes except the binary paths it calls (all under `/usr/bin` or `/bin`, SIP-protected).
- **Logging:** the harness logs the hash of `$ZSH_EXECUTION_STRING` (verified equal to `shasum` of the file) as its first log line. This is **evidence, not a control** (it is self-asserted). When run as `zsh -f file --selftest` it is empty, so the harness logs `UNPINNED`.
- **Residual (review P1-4):**
  - **The TOCTOU race is closed** (verified).
  - **Not closed:** a same-user attacker with **persistent write** access to shell startup files, the environment, Terminal profiles or the ZLE configuration could subvert the bootstrap itself (aliases, functions, line rewriting).
  - The fresh `env -i … zsh -f` window reduces this.
  - The remainder **maps to RC-18** (compromised session, accepted limitation).
  - **RC-24 status: design complete, with residual mapped to RC-18. Not closed.**

**To validate in the harness self-test** (no keychain needed):
1. A one-byte modification gives MISMATCH.
2. Replacing the file **after** the bootstrap has read it doesn't change execution (marker test).
3. Trailing-newline preservation gives a hash equal to `shasum` of the file.
