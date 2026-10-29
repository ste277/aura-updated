# RE4-01: Preflight and Scope

**Ticket:** AURA-GOV-02-RE-4 — real-environment process-scan validation. This is not a Keychain test.

## Phase A results
| # | Requirement | Result |
|---|---|---|
| 1 | Repository and worktree | `/Users/stephen/Desktop/Claude/auraschedule-math-core`, main checkout, branch `main`, HEAD `f35d35a`. Other linked worktrees exist and were not touched. |
| 2 | Git status | 107 untracked or modified entries pre-existed. `AURA_GOV_02_R2E/` was untracked; `AURA_GOV_02_RE4/` did not exist. |
| 3 | R2E manifest | `shasum -a 256 -c SHA256SUMS` gives **120/120 OK**. Manifest SHA-256 `f7cfecdb78face5e95abc75a2e955086fccc57b1b6bcf3eb5802d7d230a0c0eb` matches the expected value. Re-verified after the probe: unchanged. |
| 4 | T1-6 implementation | `AURA_GOV_02_R2E/r2d_prototype.zsh` lines 176–182: `DENY=…`; `HIT=$("$PSB" -ww -axo pid=,ppid=,comm= 2>/dev/null \| /usr/bin/awk … \| /usr/bin/sort -u \| /usr/bin/tr '\n' ';')`; then `[[ -z $HIT ]] \|\| stop`. Lines 183–185 hold the owner attestations, which are not exercised here. |
| 5 | Reachable commands | T1-6: `/bin/ps`, `/usr/bin/awk`, `/usr/bin/sort`, `/usr/bin/tr`. `is_wd` (lines 95–98): `kill -0` (no signal is delivered), `/bin/ps -ww -o command=` / `-o ppid=`, `/usr/bin/tr`. |
| 6 | Watchdog detection | `is_wd <pid> <N> <expected parent>`: numeric PID and alive, then `command=` must end with ` r2d_watchdog N <KC> <SEC>`, then `ppid=` must equal the expected parent. Used in teardown (line 106) and in the observer (line 147). |
| 7 | No `security` | Neither code path invokes `$SEC`. In `is_wd` it is a comparison string only. The probe asserts (A-2) that the extracted code contains no literal `security`. |
| 8 | No Keychain access | Neither path opens a file. The probe's `KC`/`SEC` values are strings under a scratch temp dir and are never created. |
| 9 | No existing process signalled | The probe's only signals: `kill -0` (a liveness test, nothing delivered) on the dummy's PID, and a TERM to the dummy gated on an exact identity check. The TERM was **never needed or sent**. |
| 10 | Read-only inspection | `ps` and `pgrep` only read the process table. The full listing is never stored; only counts and denylisted basenames are kept. |
| 11 | No production change | The harness is **not executed and not modified** (SHA-256 `b9dd4d43…` before and after). Its exact `is_wd` and T1-6 lines are extracted by `awk`, then `eval`'d inside the probe. The reviewer verified that the extracted text is byte-identical to the harness. |

**Isolation decision:** T1-6 and `is_wd` can be exercised independently of every Keychain operation. **Not BLOCKED.**

## Method
- **Probe:** `AURA_GOV_02_RE4/re4_probe.zsh`, SHA-256 `c19d363b2eb64bb94cb81250d45025c3246f5a4027b30b7356acc398cdb56871`. It uses absolute paths for every system tool.
- **Command of record:** `/bin/zsh -f AURA_GOV_02_RE4/re4_probe.zsh AURA_GOV_02_R2E/r2d_prototype.zsh AURA_GOV_02_RE4/evidence <scratchpad>/re4_tmp_<random>`
- **Exit code:** 0.

**The full governance harness, the R2E suite and Tier 2 were not run.**
