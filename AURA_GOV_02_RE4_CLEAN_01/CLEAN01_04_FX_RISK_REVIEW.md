# CLEAN01-04: FX-1 … FX-7 Risk Review

All line numbers refer to the pinned v2 harness, `AURA_GOV_02_RE4_FIX01/r2d_prototype.zsh`. **No fix is implemented here, and none is claimed resolved.**

## FX-1 — Name-based detection (P2, open)
**Mechanism.** The scan matches token prefixes against `ucomm` (kernel name, set from the executed file's name, ≤16 chars) and the `comm` basename (from argv[0]) (lines 203, 214–215). FIX01-05 R-2c showed on real macOS that argv[0] does not change `ucomm`.

**Not detected:**
- a copied, renamed or hardlinked executable;
- automation run by an interpreter (`node`, `Python`, `osascript` scripts run via a renamed host);
- vendor helpers whose names don't start with a token (SuperOps `updmgr`, `ScreensharingAgent`, Splashtop `SR*`);
- agents that run inside a browser process rather than as their own named process (ChatGPT for Chrome happened to run as a separately named process, so it was detected);
- anything privileged acting without a process of its own.

**Assessment.** Before CLEAN could be relied on as more than a tripwire, extra assurance is needed. Candidates:
1. Executable-path and **code-signing Team ID** identity for each PID, using `lsof`/`codesign`, read-only. This catches renamed signed vendor binaries, not unsigned tools. **Limit:** without root, `lsof` cannot read other users' or root processes (FIX01 survey S-5), so it would not reach a root RMM daemon. The `comm` path is caller-controlled argv[0] and cannot stand in.
2. Extended tokens.
3. Mandatory attestations (R2D-02 (a)/(c)).
4. Environment assurance (CLEAN01-02).

No monitoring-evasion or process-disguise technique is proposed or tested.

## FX-2 — Spoofing coverage (P3, open)
- **Covered in the mock:**
  - `T7_comm_spoofed_benign` (`FIX01/tests/r2e_selftest.zsh` line 555): a denylisted kernel name with a benign argv[0] gives DETECTED via `ucomm`.
  - `T7_comm_only_denylisted`: the inverse.
- **Covered on real macOS:** only the argv[0] side (R-2b/c/e).
- **Missing direction:** real macOS, denylisted *executable* with a benign argv[0].
- **Safe synthetic recommendation:** none beyond the existing mock is needed for the code path. A live test would mean running a denylisted executable under a disguised name, which is **live process spoofing, so not recommended**. Keep FX-2 as "mock-proven; the real kernel-name behaviour is inferred from R-2c".

## FX-3 — Timeout PID reuse (P3, open)
**Code (186–189):** `"$PSB" … & p=$!`, then `while kill -0 $p; do (( now < e )) || { kill -KILL $p; … }; sleep 0.05; done`.

**Race.** zsh reaps the finished `ps` asynchronously (SIGCHLD). Once it is reaped, PID `p` is free. If the kernel reissued `p` to a **same-uid** process inside the 10 s window, and that process was still alive at the deadline, `kill -KILL` would hit it. `kill -0` to another uid fails with EPERM, which ends the loop.

**Likelihood.** Very low. macOS hands out PIDs sequentially, so reuse within 10 s would need the PID counter to wrap. But it is not impossible, and the consequence is killing an unrelated process.

**Safer design (proposed, not implemented):**
- **Primary: never signal.** On timeout, stop waiting and report UNKNOWN; the result is fail-closed, so nothing is lost. The cost is a possibly lingering `ps` the harness started. That is benign, but note it in the log.
- **Secondary (job-state gating), with caveats.** Gate the `kill` on zsh's per-process job state showing the child still **running** (`$jobstates` requires `zmodload zsh/parameter`, which the harness does not load today). zsh reaps the child in its SIGCHLD handler but keeps the job entry until the job is reported or waited for, so **the entry existing does not mean the child is unreaped**. Only a "running" state helps, and a small window between check and kill remains.
- Replace PATH-resolved `sleep` with the `zselect` builtin (requires `zmodload zsh/zselect`, also not loaded today).

## FX-4 — Temp-file substitution (P3, open)
- **Real path:** `TD=${TMPDIR:-/tmp}` (line 24). Under the R2D-06/R2D-08 launch (`env -i HOME=… TERM=…`), `TMPDIR` is unset, so `TD=/tmp`.
- `mktemp` creates the file exclusively with mode 0600 (umask 077, line 9). `/tmp` is sticky, so **other** users cannot read, rename or replace it. **Same-uid or root** code can swap it between the write and `$(<"$f")` (186–190).
- **Window.** A same-uid process could also act between `mktemp` (185) and the redirection that opens the file (186), not only before the read.
- **Exposure:** a same-uid compromise, or root (which includes the MDM/RMM agent), which is RC-18 territory.
- **Related documentation defect.** R2D-02 T1-8 and R2D-07 (lines 18, 21) tell the owner to look in `$TMPDIR/r2d-run.*`, but under this launch mode the files live in `/tmp`. The recovery instructions should name the actual directory, which the harness already prints at start ("Manual recovery … look for $TD/r2d-run.*").
- **Reduction options:**
  1. **No file at all.** Read `ps` through a coprocess or file descriptor (`coproc`, then `read` with timeout, then `wait $!` for the status). Needs mock regression to show the exit status is still captured. **Caveat:** it still needs a bounded read and a timeout path, so the FX-3 question (whether to signal) comes back. Pair it with the no-signal timeout.
  2. A private `mktemp -d` directory (0700) created first. This only adds depth: same-uid access remains.
- Option 1 is preferred.

## FX-5 — Single scan (P3, open)
- T1-6 runs once (line 219). Protected operations start later: create and unlock (233+), then Tier 2 groups lasting minutes (L7 waits indefinitely; L8 waits T+off = 75 s in each of two phases, so ≥ 150 s in REAL mode; L10 re-attests but does not re-scan).
- **Time-of-check/time-of-use gap:** a process started after the scan, or a short-lived one between snapshots, is missed. L10 already re-attests.
- **Assessment:** one scan is **not sufficient** for operations minutes later. Recommend re-scanning before every keychain create/unlock and before L10, with STOP on DETECTED or UNKNOWN.

## FX-6 — Test gaps relevant to a CLEAN-path test (P3, open)
- **Relevant to a CLEAN run:**
  - no row-count or exit-status logging on CLEAN/DETECTED (= RR-2);
  - the real CLEAN path, including the ≥ 20-row floor, has never been run.
- **Not relevant to a CLEAN run:**
  - no mktemp-failure case;
  - no CR or newline-in-name case (either would give UNKNOWN or a false STOP);
  - the weak de-duplication assertion (cosmetic).

## FX-7 — No real CLEAN (P2, open; NOT resolved)
**Minimum evidence to close it:** one run of the pinned (or re-pinned) scanner on a real macOS host, whose log shows:
- **per read** (`ucomm`, `comm`): exit status 0, row count ≥ 20, PID 1 present, own PID present, zero duplicates;
- `SCAN=CLEAN` with **zero** hits;
- a **defined stop point**. After CLEAN the harness asks the three T1-6 attestations. **The tester answers `n` at the first one**, so the harness stops before line 229 (`glob_state`, the first `/usr/bin/security` call), exactly as `T7_clean_fixture` does. The log must show that stop and **no `security` call**.

Host precondition: Claude, Claude Code, Codex and ChatGPT (including ChatGPT for Chrome) must **not** run on the test host. All of them match the denylist (FIX01 survey S-3), so a run driven by an AI agent on that host can never be CLEAN. The run must be performed by the owner directly.

It also needs:
- a hashed, **redacted** table (pid / ppid / 16-char names only, no arguments);
- a manifest;
- an independent review;
- a written statement of which host was used and why it is representative, plus owner (and, where required, administrator) authorization.
