# AURA-DISK-02 — 01 Baseline

**Ticket:** AURA-DISK-02 — Tier A Worktree Retirement (preflight only)
**Predecessor:** AURA-DISK-01 (`AURA_DISK_01/`)
**Date:** 2026-11-14, preflight snapshot 16:27 local
**Auditor:** Claude (AI). No human verification is claimed.
**Authorization:** preflight only. Nothing was removed, unlinked, pruned, fetched or modified. The only writes were this package (`AURA_DISK_02/`) and scratch copies in the session scratchpad.

## 1. Predecessor evidence

| Check | Result |
|---|---|
| `AURA_DISK_01/SHA256SUMS` entries | 21 |
| `shasum -a 256 -c SHA256SUMS` failures | **0** |
| SHA-256 of `AURA_DISK_01/SHA256SUMS` | `def176de118f9a782b141f7eab40122990f223fc4a1b5e922cd7a2c3f26b83ca` |

## 2. Refs used (recorded, not updated)

| Ref | SHA |
|---|---|
| Main checkout `HEAD` / local `main` | `f35d35ab6ed4568f58f766ce0122a3a1b471b4dc` |
| `origin/main` | `1741a95a3bc5c364f71a743442a8e31557756c33` |
| `.git/FETCH_HEAD` mtime | 2026-11-11 19:20 (no fetch performed) |

Local `main` remains 49 commits behind `origin/main`. Reachability was tested against `origin/main` as recorded above.

## 3. Tier A derivation (source of truth)

Tier A was **not** rebuilt from directory names or age. It was derived from the DISK-01 CSVs using the rule written in `DISK01_08_RECOVERY_SCENARIOS.md`:

> `classification == REMOVAL CANDIDATE` (DISK01_07) **and** `head_in_origin_main == yes` **and** `max(last_commit, last_reflog) < 2026-10-15` (DISK01_02).

| Check | Result |
|---|---|
| REMOVAL CANDIDATES in DISK01_07 | 47 |
| Rows matching the Tier A rule | **40** |
| 47 − 40 equals the 7 Tier B names listed in DISK01_08 | **yes, exact set match** |
| Reported size in DISK-01 | 7.72 GiB |
| Size re-measured now | 7.72 GiB |

The list is unambiguous. The other 81 registered worktrees (35 PRESERVE, 39 REVIEW, 7 Tier B) were excluded and not touched. Their classifications, including the HPG4 PRESERVE rows, were not changed.

## 4. Package contents

| File | Content |
|---|---|
| DISK02_01_BASELINE.md | This file |
| DISK02_02_TIER_A_PREFLIGHT.csv | 40 rows in proposed order with every check, method and prerequisite |
| DISK02_03_SYMLINK_AND_PROCESS_REVIEW.md | Symlinks, clean-tree behaviour, processes, sessions |
| DISK02_04_RETIREMENT_PLAN.md | Ordered plan and methods (not executed) |
| DISK02_05_RECOVERY_AND_ROLLBACK.md | How to rebuild any retired worktree |
| DISK02_06_INDEPENDENT_REVIEW.md | Independent AI review |
| DISK02_FINAL_GATE_REPORT.md | Gate decision |
| SHA256SUMS | Manifest |
| raw/ | `preflight.sh`, `pf.tsv` (raw checks), `pfsym.tsv` (outside-pointing symlinks), `tierA.tsv` |
