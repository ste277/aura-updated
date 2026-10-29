# AURA-DISK-04 — 05 Monitoring Guidance (proposed)

**Status: PROPOSED maintenance thresholds.** These are not approved security or engineering policies, and they do not trigger any automatic action.

## 1. Thresholds (free space, decimal GB as Finder shows; GiB in brackets)

| Free space | Category | Proposed response |
|---|---|---|
| **≥ 25 GB** (≥ 23.3 GiB) | NORMAL | Normal development; no cleanup required |
| **20–25 GB** (18.6–23.3 GiB) | OBSERVE | Observe the disk trend (e.g. run the monitor before and after large builds) |
| **15–20 GB** (14.0–18.6 GiB) | ASSESS | Begin a fresh **read-only** storage assessment (DISK-01 style) |
| **Below 15 GB** (< 14.0 GiB) | PRIORITIZE | Prioritise a storage review before large builds (Xcode, Gradle, `next build`) |

Boundary handling in the script: free space is truncated to whole GB before comparison, so 25.00 GB → NORMAL but 24.99 GB → OBSERVE; likewise 20 → OBSERVE and 15 → ASSESS.

**Current reading:** 33.18 GB (30.90 GiB) at 16:57:33 → **NORMAL**.

Context: a macOS/Xcode upgrade appears staged (DISK-01 observed `com.apple.os.update-MSUPrepareUpdate` and a 10.8 GB Preboot volume). Check the upgrade's own space requirement against the current reading before starting it.

## 2. Monitoring script — `AURA_DISK_04/disk_monitor.sh`

- **Run manually only:** `bash AURA_DISK_04/disk_monitor.sh`
- **Reports:** timestamp, free space (diskutil "Capacity Not Allocated" of the APFS container that holds `/`, found with `diskutil info /`; falls back to df) in bytes/GB/GiB, `df` available, `.claude/worktrees` size, registered worktree count, proposed category.
- **Reads only:** `diskutil info /`, `diskutil apfs list`, `df -k /`, `du -sk .claude/worktrees`, `git worktree list --porcelain` (with `GIT_OPTIONAL_LOCKS=0`).
- **Never:** deletes files, calls `git worktree remove/prune` or any other Git write, clears caches, stops processes, writes files, or installs launchd, cron or background jobs.
- **Independent** of `AURA_DISK_03/raw/retire.sh` and `checkpoint.sh`; it shares no code with them.

### Validation (read-only)

| Check | Result |
|---|---|
| `bash -n` syntax | OK |
| Scan for `rm`, `rmdir`, `unlink`, `prune`, `worktree remove/add`, `kill`, `launchctl`, `crontab`, `mv`, `chmod`, `tee`, Git write verbs | no matches. The only `>` characters are `2>/dev/null` and the `>=` text in a category label |
| Live run | OK, exit 0. First run 16:53; re-run after the container-binding fix 16:57:33 (`raw/monitor_validation_run.txt`) |
| Container binding (review P3-A) | `diskutil info /` → disk3; the script now reads only that container's block. Previously it took the first container listed |
| Side effects of re-run | worktree-list hash and recursive package listing hash identical before and after |
| `git worktree list --porcelain` hash before vs after run | identical |
| Files created by the run | none (directory listing unchanged) |
| Category logic at 30 / 22 / 17 / 12 GB | NORMAL / OBSERVE / ASSESS / PRIORITIZE |

`du` over `.claude/worktrees` takes a few seconds (≈24 GiB of files).
