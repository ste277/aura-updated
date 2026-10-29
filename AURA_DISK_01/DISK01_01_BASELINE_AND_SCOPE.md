# AURA-DISK-01 — 01 Baseline and Scope

**Ticket:** AURA-DISK-01 — Read-Only Worktree Retention and Storage Recovery Audit
**Audit date:** 2026-11-14 (local)
**Auditor:** Claude (AI, Claude Code desktop session). No human verification is claimed anywhere in this package.
**Mode:** Strictly read-only. The only writes were this evidence package (`AURA_DISK_01/` in the main checkout root) and scratch copies in the session scratchpad.

## 1. Verified baseline

| Item | Reported in ticket | Verified |
|---|---|---|
| Repository root | `/Users/stephen/Desktop/Claude/auraschedule-math-core` | Confirmed |
| Main checkout branch | main | `main` |
| Main checkout HEAD | `f35d35ab6ed4568f58f766ce0122a3a1b471b4dc` | Confirmed — unchanged |
| `origin/main` (last fetch 2026-11-11 19:20) | not stated | `1741a95a3bc5c364f71a743442a8e31557756c33` (PR #347 merge, 2026-11-10) |
| Local `main` vs `origin/main` | — | **local main is 49 commits behind origin/main** (`[behind 49]`) |
| Remote | — | `origin` → github.com/ste277/aura-updated |
| Worktree directory | `.claude/worktrees/` | Confirmed |
| Registered worktrees | ~ | **121** (main + 120 under `.claude/worktrees/`) |
| Unregistered dirs in `.claude/worktrees/` | — | **2** (`agent-a8da33ba4e882df81`, `apps`) |
| Locked / prunable / missing-path worktrees | — | **0 / 0 / 0** |
| Submodules | — | None (`.gitmodules` absent) |
| Worktree storage | ~32 GB | **31.69 GiB (34.03 GB decimal)** by `du -sk` of `.claude/worktrees` |
| Free space (container) | 25.4 GB | **25.17 GB not allocated** (`diskutil apfs list`); `df -h /` shows 24 GiB available |
| APFS container | ~245.1 GB | 245.107 GB, 89.7 % used |

Main checkout Git status: 0 modified, 0 staged, 332 untracked entries (existing AURA evidence files/dirs), 18 ignored entries.

**Consequence of the stale local main:** "HEAD reachable from main" was evaluated against both local `main` and `origin/main`. Many worktrees that look "ahead of main" locally are already in `origin/main`. `git fetch` was **not** run (it would modify refs); `origin/main` reflects the 2026-11-11 fetch.

## 2. Scope

Covered:
- Every entry from `git worktree list --porcelain` (authoritative inventory), including 17 detached worktrees.
- All directories present in `.claude/worktrees/` (registered or not) and `.git/worktrees/` admin dirs (120, names all match their gitdir paths, none locked).
- Per-worktree tracked/staged/untracked/ignored state, commit reachability, upstream, PR state (via `gh pr list --state all`, read-only), activity timestamps, symlinks, processes and Claude desktop session bindings.
- Storage by category (dependencies, build output, untracked, ignored, source/Git).
- The five authorised developer-storage locations in `~/Library` (sizes only).

Not covered / limits:
- No `git fetch`; remote state may be up to 3 days stale.
- Codex activity was assessed only through running processes and `refs/codex/*`; Codex's own session store was not inspected (outside authorised paths).
- APFS clone (shared-extent) status of individual files cannot be measured with read-only standard tools; see 06.
- Process ownership is a point-in-time snapshot (2026-11-14 ~16:10).

## 3. Method and safety controls

- All `git status` calls ran with `GIT_OPTIONAL_LOCKS=0` so no index was refreshed or rewritten.
- `du` on macOS does not follow symlinks (default `-P`); symlinked `node_modules` were recorded, not traversed.
- No prohibited command (worktree remove/prune, branch delete, clean, reset, gc, repack, rm, cache clean, checkout, kill, fetch) was executed.
- Scripts used are preserved in `raw/` (`collect.sh`, `storage.sh`, `classify.py`) together with their raw outputs.

## 4. Package contents

| File | Content |
|---|---|
| DISK01_01_BASELINE_AND_SCOPE.md | This file |
| DISK01_02_COMPLETE_WORKTREE_INVENTORY.csv | 121 registered + 2 unregistered entries, all required fields |
| DISK01_03_GIT_STATUS_AND_REACHABILITY.md | Working-tree state and commit preservation |
| DISK01_04_UNTRACKED_IGNORED_AND_EVIDENCE.md | Untracked/ignored content and evidence |
| DISK01_05_PROCESS_AND_OWNERSHIP_REVIEW.md | Processes, sessions, locks, cross-worktree dependencies |
| DISK01_06_STORAGE_BREAKDOWN.md | Storage by category and APFS caveats |
| DISK01_07_RETENTION_CLASSIFICATION.csv | Final classification per worktree |
| DISK01_08_RECOVERY_SCENARIOS.md | Conservative / Moderate / Maximum-reviewed |
| DISK01_09_ADDITIONAL_STORAGE_CANDIDATES.md | `~/Library` developer storage |
| DISK01_10_INDEPENDENT_REVIEW.md | Independent AI review findings |
| DISK01_FINAL_GATE_REPORT.md | Gate decision |
| SHA256SUMS | Manifest of all files above and `raw/` |
| raw/ | Collector scripts and raw TSV outputs |
