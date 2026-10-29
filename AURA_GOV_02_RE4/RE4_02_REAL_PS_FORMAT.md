# RE4-02: Real `/bin/ps` Format

**Environment:** macOS 14.6 (23G80), zsh 5.9 (x86_64-apple-darwin23.0), uid 501, no administrator rights. Evidence run 2026-11-14T10:05:21Z.

| Check | Command | rc | Observation |
|---|---|---|---|
| B-1 | `/bin/ps -ww -axo pid=,ppid=,comm=` | 0 | 599 lines; **599/599** match `^ *<pid> +<ppid> +<comm>`. 575 have an absolute-path comm, 24 do not. 316 lines start with leading spaces (right-aligned PIDs). Longest line 232 chars. The listing was **not stored**. |
| B-2 | `/bin/ps -ww -o pid=,ppid=,comm= -p 999999` (absent PID) | 1 | stdout empty; a 32-char message on stderr. |
| C-2 | `/bin/ps -ww -o command= -p <dummy>` | 0 | 423 chars, **exactly** the expected argv. |
| C-3 | the same without `-w`, and with `-w`, stdout a pipe | 0 | Also 423 chars, so **no truncation** when stdout is not a tty. The tty case is untested; the harness always passes `-ww`. |
| C-4 | `/bin/ps -ww -o ppid= -p <dummy>` | 0 | `57668` = driver PID. |
| C-4 | `/bin/ps -o stat= -p <dummy>` | 0 | `SN` (sleeping, niced). The harness does not use the state. |
| C-5/C-6 | `/bin/ps -ww -o pid=,ppid=,comm= -p <dummy>` | 0 | `57728 57668 /re4/osascript-re4dummy`. **`comm` reports argv[0]**, which the caller controls, **not** the executable path (`/bin/zsh`). |
| E-3 | `/bin/ps -ww -o pid=,ppid=,comm= -p <dummy>` after it exited | 1 | No output. |

## Compatibility with the R2E mock assumptions
- **Compatible:**
  - field order and whitespace (awk's default field splitting handles the leading spaces);
  - exact-PID `command=` / `ppid=` lookups;
  - non-zero return code and no record for an absent PID;
  - no pipe truncation.
- **Different from the mock (material):** the R2E mock simulated `comm` as an executable path. Real `comm` is **argv[0]**, so T1-6 detects a *caller-chosen name*, not the program that is running (finding RV4-2).
- The 24 non-absolute `comm` values are processes reported by short name. They are prefix-matched the same way.
