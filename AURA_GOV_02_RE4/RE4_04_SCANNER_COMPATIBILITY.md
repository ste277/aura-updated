# RE4-04: Scanner Compatibility (real environment)

| Aspect | Real behaviour | Harness assumption | Compatible? |
|---|---|---|---|
| `-axo pid=,ppid=,comm=` field layout | 599/599 lines parse; leading spaces present | awk default FS | **Yes** |
| PID / PPID values | Exact; `ppid=` padded with spaces, stripped by `tr -d ' '` | Same | **Yes** |
| `command=` with `-ww` | Full argv, exact (423 chars) | Exact-tail match | **Yes** |
| Truncation | None to a pipe, even without `-w`; `-ww` used anyway | `-ww` | **Yes** (tty untested; moot) |
| Absent PID | rc=1, no stdout record | No record means no match | **Yes** |
| `comm=` identity | **argv[0]** (caller-controlled) | Executable name | **No: semantic gap (RV4-2)** |
| `ps` failure or empty output | Not exercised for real | **T1-6 treats an empty result as clean** | **No: fail-open (RV4-1)** |

## Watchdog identification (`is_wd`), the RE-4b portion
**Real-environment PASS:**
- exact PID;
- exact argv tail;
- parent equality;
- rejection of a wrong parent, wrong N, partial or different paths, and partial security path;
- rejection after exit.

**Not exercised:** the observer's harness-identity check (line 146) matches the long multi-line harness script in `command=`. It fails closed (review RV4-6).

## T1-6 name scan
**Real-environment results:**
- The real table is read and parsed.
- Denylisted names are found: the dummy, and real Claude, ChatGPT and SuperOps processes.
- The harness-child exclusion works on real data.

**Limitations:**
1. **Fail-open (RV4-1, P1).** `ps` stderr and exit status are discarded, and an empty `HIT` means "clean". Under any condition where `/bin/ps` fails or prints nothing (for example a sandbox, which R2E observed), T1-6 would log "process scan clean".
2. **argv[0] evasion (RV4-2, P2).** A process can choose a non-denylisted argv[0] and avoid the scan.
3. **No clean leg (RV4-3, P2).** No true-negative run was possible, because Claude, ChatGPT for Chrome and superops are running.
4. **Over-broad matching (fail-safe).** Matching is prefix-based (`claudette`); the `.` in `zoom.us` is unescaped; grandchildren are not excluded.

## Proposed source corrections (documented only; NOT implemented under RE-4)
1. **RV4-1.** Capture the `ps` output first. STOP unless:
   - rc = 0;
   - the line count is ≥ a sane minimum;
   - every line parses;
   - a row with `pid == ME` is present.

   Only then filter. Add a synthetic test where a failing or empty PSB must STOP.
2. **RV4-2.** Also scan `ucomm=` (the kernel accounting name, which the caller cannot set) and STOP if either name matches. State in RC-20 that the scan gives no assurance against a renamed or hostile process, and that the owner attestation is the control.
3. **Hygiene.** Escape regex metacharacters in DENY (`zoom\.us`). Optionally exclude all descendants of the harness.
4. **RV4-7.** Read `ppid=,command=` in a single `ps` call immediately before any signal. Add an identity check to teardown's `pkill -P` (line 104).
