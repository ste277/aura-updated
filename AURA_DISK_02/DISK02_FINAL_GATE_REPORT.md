# AURA-DISK-02 — Final Gate Report

**Gate decision: PASS. The retirement plan is ready for owner approval.**
**Deletion is NOT authorised by this ticket. Nothing was removed, unlinked, pruned, fetched, committed or modified.**
Date: 2026-11-14 · Auditor: Claude (AI) · Independent review: separate Claude (AI) subagent. No human verification is claimed.

## Gate criteria

| PASS requirement | Result |
|---|---|
| Exact eligible list established | ✔ 40, derived from the DISK-01 CSVs by the documented rule. Exact set match with DISK01_08 (47 − 7 Tier B). Independently recomputed |
| DISK-01 manifest verified | ✔ 21/21 OK |
| All mandatory checks pass (×40) | ✔ registration/branch/HEAD unchanged; HEAD ∈ origin/main; 0 commits outside origin/main; 0 reflog-only commits; 0 modified/staged/untracked files (symlinks aside); ignored content regenerable only; `.env.local` none, symlink or identical to main; all outside symlinks point to main or the stub; nothing links in; no process; no Claude/Codex session; no HPG/mobile/PALM/GOV/Panchangam association; no evidence dependency |
| No unresolved P0/P1 | ✔ none raised. Both P2 and all three P3 findings are incorporated into the plan |
| Retirement plan ready | ✔ ordered plan, per-worktree gate, methods M1/M2 without `--force`, rollback (04, 05) |

## Results
- **Eligible:** 40 of 40 Tier A worktrees. **Exclusions:** none.
- **Expected recovery:** 7.72 GiB by `du` (7,907 MiB). Planning range 6.9–7.7 GiB physical. Free space should go from 25.2 GB to about 32.6–33.5 GB.
- **Methods:**
  - **M1 (38 worktrees):** guarded `unlink` of the two untracked `node_modules` symlinks into main, then plain `git worktree remove`.
  - **M2 (2 worktrees):** plain `git worktree remove`.
  - **`--force` is never needed.** The only reason Git's clean-tree check would reject the 38 is those symlinks: `.gitignore`'s `node_modules/` matches directories only, so the links count as untracked.
- **Order:** 4 M1 canaries (day-constructor-v1-pr-d/e1/e2/e3, 9 MiB each), then the M2 canary location-pr8 with a verification pause, then the rest, largest first.
- **Untouched:** the other 81 worktrees (including HPG4 PRESERVE rows, unchanged), all branches, the main checkout's dependencies and env, both stub dirs, and all caches and Xcode/simulator data.

## Refs recorded
main/HEAD `f35d35ab6ed4568f58f766ce0122a3a1b471b4dc` · origin/main `1741a95a3bc5c364f71a743442a8e31557756c33` (fetch 2026-11-11 19:20; no fetch performed).

## Exact next owner decision
Approve or decline: **"Execute DISK02_04_RETIREMENT_PLAN for the 40 listed worktrees, in the listed order, using only methods M1/M2 with the per-worktree gate, stopping at the first unexpected result."** If approved, the run must re-check every gate item immediately before each removal, so it may still skip worktrees that have changed since this preflight.

## Manifest
`SHA256SUMS` covers every file in `AURA_DISK_02/` including `raw/`. Verified with `shasum -a 256 -c SHA256SUMS`.
