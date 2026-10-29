# AURA-DISK-04 — 01 Baseline Verification

**Ticket:** AURA-DISK-04 — Cleanup Closure and Disk-Space Monitoring Baseline
**Mode:** read-only verification and documentation. **Date:** 2026-11-14, from 16:51 local.
**Author:** Claude (AI). No human verification is claimed.
Historical packages AURA_DISK_01/02/03 were read and hash-verified only. **They were not modified.**

## 1. Evidence manifests

| Package | Expected | Verified | Failures | SHA-256 of SHA256SUMS (prefix) |
|---|---|---|---|---|
| AURA_DISK_01 | 21/21 | **21/21** | 0 | `def176de118f9a78` (same as recorded in DISK02_01) |
| AURA_DISK_02 | 11/11 | **11/11** | 0 | `7dd2c18d1800d1c0` (same as recorded in DISK-03) |
| AURA_DISK_03 | 25/25 | **25/25** | 0 | `306f3a2f683221ac` (same as at DISK-03 closure) |

## 2. DISK-03 closure facts, re-checked

| Item | Expected | Verified now | Source |
|---|---|---|---|
| Approved worktrees retired | 40 | **40** have a POSTVERIFY_OK entry; all 40 paths are absent and unregistered, and none of their `.git/worktrees/<name>` admin dirs has reappeared | `AURA_DISK_03/raw/exec_log.tsv`, live `git worktree list` |
| Remaining worktrees | 81 | **81** registered (main + 80 linked), 80 admin dirs | live |
| Space recovered | 8,393,150,464 B | 33,292,980,224 − 24,899,829,760 = **8,393,150,464 B** | `DISK03_07`, `raw/baseline_diskutil.txt` |
| Recovery in GiB | ≈7.82 | 8,393,150,464 / 2³⁰ = **7.817 GiB** (8.393 GB) | arithmetic |
| Main HEAD at closure | `f35d35a` | `f35d35ab6ed4568f58f766ce0122a3a1b471b4dc` (current HEAD unchanged; branch `main`, 0 tracked changes) | live |

`f35d35a` is the historical closure baseline. A later authorised commit on main would not be a cleanup failure.

## 3. Retired branches preserved

All **40/40** branches from `AURA_DISK_02/DISK02_02_TIER_A_PREFLIGHT.csv` exist at exactly the recorded HEAD SHA (`git rev-parse refs/heads/<branch>` = CSV `head`).

## 4. Other refs
- `origin/main` = `1741a95a3bc5c364f71a743442a8e31557756c33`, unchanged. `.git/FETCH_HEAD` is still dated 2026-11-11 19:20, so no fetch has happened since.
- Shared-dependency fingerprint (main `node_modules`, `apps/web/node_modules`, `apps/web/.env.local` hash prefix, both stub folders) recomputed with the DISK-03 formula: **identical to the DISK-03 baseline**. A first recomputation attempt failed to load the helper function and printed a spurious "DIFFERS". It was re-run correctly → identical. Nothing changed between the two runs.
