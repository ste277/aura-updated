# RE4-03: Dummy-Process Validation

## The dummy (evidence run, attempt 3)
- **Command:** `ARGV0=/re4/osascript-re4dummy /bin/zsh -f -c 'zmodload zsh/zselect; zselect -t 3000' r2d_watchdog 7 <tmp>/r2d-run.RE4DUMMY/r2d.keychain-db <tmp>/no-such-tool/RE4-MARKER &`
- **Executable:** the real `/bin/zsh`, unmodified. **argv[0]:** a non-existent marker path chosen to match the denylist prefix `osascript`.
- **Argument shape:** identical to the real watchdog, `r2d_watchdog <N> <kc> <sec>`.
- **What it does:** `KC` and `SEC` are plain strings, never created and ignored by the script. `zselect` is a zsh builtin, so the dummy makes no fork, opens no file and uses no network. It needs no admin rights and installs no service. Its lifetime is bounded at 30 s.
- **Identity:** PID **57728**, parent **57668** (the probe driver).
- **End:** it **exited by itself** at 30.04 s with status 1 (the `zselect` timeout). **No signal was sent.**

## Earlier attempts (disclosed)
| Attempt | Dummy | Outcome |
|---|---|---|
| 1 | A copy of `/bin/zsh` at `<tmp>/bin/osascript-re4dummy` | The evidence dir did not exist, so every log write failed and **no log was produced**. The probe version then lacked the log guard it now has, and was overwritten in place (not preserved). Afterwards `pgrep -f RE4-MARKER` and `pgrep -f osascript-re4dummy` both returned 1 (no match), and no `re4_tmp_*` dir remained. |
| 2 | The same copied binary | **macOS SIGKILLed the copy** about 0.6 s after start (status 137). We sent no signal; this is most likely code-signing enforcement on a relocated platform binary. 33 PASS / 8 FAIL. Log kept as `evidence/re4_run_attempt2_copied-binary-killed.log`. |
| 3 | Real `/bin/zsh` with `ARGV0` | **Evidence of record:** `evidence/re4_run.log` |

Between attempts 2 and 3, three pass criteria changed. All are disclosed here (review RV4-5):
- **A-1:** the T1-6 extract is 5 lines, not 6. The earlier count was wrong.
- **B-2:** stderr is now separated from stdout. The 32 chars in attempt 2 were the stderr message.
- **C-5:** the comm-equals-executable assertion was replaced by an observation (C-6). The observation is the finding: comm = argv[0].

## Results (attempt 3): 41 PASS / 0 FAIL / 4 INFO
| ID | Check (exact harness code, real `/bin/ps` unless marked synthetic) | Result |
|---|---|---|
| RE4-01 | `is_wd(57728, 7, 57668)` → match | PASS |
| RE4-01b | T1-6 real scan, exclusion disabled → reports `osascript-re4dummy` | PASS |
| RE4-01c | T1-6 real scan → reports the running Claude processes | PASS (expected STOP condition) |
| RE4-02a/b | Parent 1, or the driver's own parent → reject | PASS |
| RE4-02c | T1-6 with ME = driver → dummy (ppid==ME) excluded | PASS |
| RE4-03a–f | Wrong N, `7x`, keychain-path prefix, other keychain path, security-path prefix, empty KC → reject | PASS |
| RE4-04a/b | Synthetic table: Claude, Claude Helper (Renderer), osascript (path and bare), TeamViewer detected; notclaude, my-osascript, zsh, malformed line not detected | PASS |
| RE4-04c | Synthetic: harness PID and its child excluded | PASS |
| RE4-04d/e (INFO) | A grandchild is **not** excluded; `claudette` prefix-matches `claude` | Over-broad, fail-safe |
| RE4-04f/g | Synthetic `r2d_watch`, `xr2d_watchdog` → reject | PASS |
| RE4-05a–d | Natural exit; afterwards ps rc=1 with no record, `is_wd` rejects, scan no longer reports it | PASS |
| RE4-06 | All loops bounded; probe 30.3 s (< 90 s) | PASS |
| RE4-07a–i | Malformed or empty PID; missing, truncated or extended command; lookalike security suffix; missing ppid; ppid 1; extra-digit ppid → reject | PASS |
| RE4-07j | Synthetic control (exact record, padded ppid) on the **live** dummy → match | PASS |

**Real denylisted names observed (basenames only):** `ChatGPT for Chrome`, `Claude`, `Claude Helper`, `Claude Helper (Renderer)`, `claude`, `superops`. A real T1-6 run would **STOP** on this Mac until these are quit. `superops` matches the remote-management entry (likely an RMM agent), and the owner should identify it.

**Vacuous-pass caveat (review RV4-4).** The rejection checks would also pass if the dummy were dead, as attempt 2 shows. In attempt 3 they are supported by live positive controls before (RE4-01) and after (RE4-07j, real `kill -0`), and by the natural exit at 30.04 s. The probe does not enforce this bracketing structurally.
