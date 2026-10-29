# AURA-DISK-03 — 07 Disk Recovery

| Measure | Baseline (16:39:56) | Final (16:44:23) | Change |
|---|---|---|---|
| `diskutil` Capacity Not Allocated (container disk3) | 24,899,829,760 B (24.90 GB) | 33,292,980,224 B (33.29 GB) | **+8,393,150,464 B = 7.82 GiB (8.39 GB)** |
| `df -k /` available | 24,316,228 KiB | 32,512,492 KiB | +7.82 GiB |
| `du -sk .claude/worktrees` | 33,230,668 KiB | 25,135,512 KiB | −8,095,156 KiB = **7.72 GiB** |

- DISK-02 estimate was 7.72 GiB `du` (planning range 6.9–7.7 GiB). The **directory usage fell by exactly 7.72 GiB**, which matches the preflight sum and shows no APFS clone sharing in these worktrees.
- Container free space rose by 7.82 GiB. It is slightly above the `du` figure because other active sessions' writes and deletes happened concurrently (net positive over the window), and because `du` excludes some per-file metadata. Treat **7.7–7.8 GiB** as the measured recovery.
- Sum of the 39 logged per-step deltas: 7,950 MiB (canary 1 not logged; ≈9 MiB).
- Biggest single gains: insights-v1-pr6 +764 MiB, location-pr8 +541 MiB, insights-v1-pr4 +321 MiB, insights-v1-pr5 +315 MiB.

**Final free space: 33.29 GB (31.0 GiB).** `.claude/worktrees` now uses 23.97 GiB across 80 linked worktrees and 2 stubs.
