# AURA-DISK-04 — 03 Storage Baseline

Units: **GB = 10⁹ bytes (decimal, as Finder shows)**, **GiB = 2³⁰ bytes (binary)**. Free space = `diskutil apfs list` "Capacity Not Allocated" for the APFS container holding `/` (currently disk3, per `diskutil info /`), unless stated otherwise.

## 1. Historical DISK-03 results (preserved verbatim, not re-measured)

| Measure | Bytes | GB | GiB | Source |
|---|---|---|---|---|
| Free before cleanup (16:39:56) | 24,899,829,760 | 24.90 | 23.19 | `AURA_DISK_03/raw/baseline_diskutil.txt` |
| Free immediately after (16:44:23) | 33,292,980,224 | 33.29 | 31.01 | `AURA_DISK_03/DISK03_07_DISK_RECOVERY.md` |
| **Recovered** | **8,393,150,464** | **8.39** | **7.82** | difference |
| `.claude/worktrees` reduction (`du`) | 8,095,156 KiB = 8,289,439,744 | 8.29 | **7.72** | 33,230,668 → 25,135,512 KiB |

These are historical results of the DISK-03 retirement and are not re-attributed.

## 2. Fresh measurement (this ticket, read-only)

| Measure | Bytes | GB | GiB | Time |
|---|---|---|---|---|
| Free space (diskutil) | 33,371,217,920 | 33.37 | 31.08 | 16:53:12 |
| `df -k /` available | 33,371,217,920 | 33.37 | 31.08 | 16:53:12 |
| `.claude/worktrees` (`du -sk`) | 25,743,499,264 | 25.74 | 23.98 | 16:52 |
| Registered worktrees | 81 | — | — | 16:52 |
| Proposed category (DISK04_05) | NORMAL (≥ 25 GB) | | | |
| Re-run after script fix (container bound to `/`) — free space | 33,183,518,720 | 33.18 | 30.90 | 16:57:33 |
| Re-run — `.claude/worktrees` | 25,743,560,704 | 25.74 | 23.98 | 16:57:33 |

The 16:53 readings come from the first validation run. `raw/monitor_validation_run.txt` holds the 16:57:33 re-run of the corrected script (independent review P3-A). The ≈0.19 GB difference between the two runs is concurrent activity by other sessions.

## 3. Interpretation
- Current free space is about 78 MB higher than at DISK-03 closure (33,371,217,920 vs 33,292,980,224 B). `.claude/worktrees` is about 4.7 MB larger than right after closure (25,738,764,288 B = 25,135,512 KiB then; 25,743,499,264 B now). Both changes come from other active sessions (hpg2, palm-g4a-scan and main evidence growth, temporary files elsewhere) writing and deleting files. **There is no evidence linking them to DISK-03**, and they are not attributed to it.
- Free space fluctuates by tens of MB minute to minute because of concurrent work. Use the historical figures above for the cleanup result and fresh `disk_monitor.sh` runs for current state.
