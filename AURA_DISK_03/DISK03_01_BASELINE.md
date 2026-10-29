# AURA-DISK-03 — 01 Execution Baseline

**Ticket:** AURA-DISK-03 — Controlled Retirement of 40 Tier A Worktrees
**Authorization:** GO, restricted filesystem changes, exactly the 40 DISK-02-approved worktrees. Branch deletion not authorised.
**Operator:** Claude (AI). **Date:** 2026-11-14. Baseline captured 16:39:56 local, before any modification.
Raw files: `raw/baseline_*`.

## 1. Predecessor evidence

| Package | Manifest entries | Failures | SHA-256 of SHA256SUMS | Matches value recorded downstream |
|---|---|---|---|---|
| AURA_DISK_01 | 21 | 0 | `def176de118f9a78…` | yes (DISK02_01) |
| AURA_DISK_02 | 11 | 0 | `7dd2c18d1800d1c0…` | yes (DISK-02 final response) |

## 2. Repository baseline

| Item | Value |
|---|---|
| Main checkout HEAD | `f35d35ab6ed4568f58f766ce0122a3a1b471b4dc` (`main`) |
| Main tracked changes | 0 modified, 0 staged (`raw/baseline_main_state.txt`) |
| Main untracked entries | 114 top-level entries (`raw/baseline_main_status_full.txt`), produced by other sessions' evidence work |
| `origin/main` | `1741a95a3bc5c364f71a743442a8e31557756c33`; main HEAD is an ancestor (`raw/baseline_origin_main.txt`) |
| Registered worktrees | **121** (`raw/baseline_worktree_list.txt`) |
| Local refs (heads, tags, stash) | `raw/baseline_refs.txt` |
| Remote refs | `raw/baseline_remote_refs.txt` (no fetch performed during the run) |
| `.claude/worktrees` du | 33,230,668 KiB |

## 3. Disk baseline (`diskutil apfs list`, container disk3)

| Item | Value |
|---|---|
| Capacity ceiling | 245,107,195,904 B |
| Capacity Not Allocated | **24,899,829,760 B (24.9 GB)** |
| `df -k /` available | 24,316,228 KiB |

The 24.9 GB is 0.3 GB below DISK-02's 25.2 GB, because other active sessions consumed space in the meantime. Recovery below is measured against this fresh baseline, not the DISK-01/02 figure.

## 4. Shared-dependency fingerprint (`raw/baseline_shared_fp.tsv`)

For each target the fingerprint records inode, mode and mtime, plus a hash of its sorted recursive file listing. For the env file it records inode, mode, mtime, size and a SHA-256 prefix only; contents were never read into evidence.

| Target | Role |
|---|---|
| `node_modules` (main) | target of 38 M1 symlinks |
| `apps/web/node_modules` (main, empty dir) | target of 38 M1 symlinks and 21 `.next/standalone` links |
| `apps/web/.env.local` (main) | target of 3 env symlinks |
| `.claude/worktrees/apps` (stub) | target of 8 `.next/standalone` links. Must stay untouched |
| `.claude/worktrees/agent-a8da33ba4e882df81` (stub) | Must stay untouched |

## 5. Concurrency checks
- No `git gc|repack|prune|worktree|fetch|pull|rebase|merge|clean` process was running, and no `*.lock` file existed under `.git` (depth 3).
- Claude sessions (active and archived): none had a Tier A cwd. Bound worktrees were agitated-swanson, vigilant-spence, lucid-heisenberg (gone), vigilant-robinson, loving-bardeen, amazing-sanderson, objective-albattani and objective-raman, none of them approved.
- Known protected-worktree processes: adb and Temurin-17 Gradle in hpg2-goal-linked-plans, Claude-spawned zsh in agitated-swanson and amazing-sanderson. These were left running and untouched.

## 6. Pre-execution dry run
The full per-worktree gate (`raw/retire.sh check`) ran read-only on all 40 before the first removal: **40/40 PASS**. Two earlier dry-run attempts failed on tooling, before any modification (see 06 §4). Nothing was changed by either.
