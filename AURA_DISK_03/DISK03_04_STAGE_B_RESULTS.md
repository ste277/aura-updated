# AURA-DISK-03 — 04 Stage B Results (location-pr8 checkpoint)

`location-pr8-reliable-confirmation` was the M2 canary: the first removal of a worktree holding a **real** `node_modules` (≈409 MiB) and a regular `.env.local` file (byte-identical to main's at preflight). It used plain `git worktree remove`, with no symlink handling, after the full gate.

| # | Worktree | Branch | HEAD | Preflight MiB | Gate | Symlinks | Removal | Branch kept (= HEAD) | Registration | Free Δ MiB | Time | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 5 | `location-pr8-reliable-confirmation` | `worktree-location-pr8-reliable-confirmation` | `bed9ed75d794` | 535.2 | PASS (2× incl. dry-run) | none (M2) | removed, plain `git worktree remove` rc=0 | yes | absent | 542 | 16:42:15 |  |

## Stage B checkpoint — PASS (16:42:17)

| Required verification | Result |
|---|---|
| Main checkout HEAD and tracked status unchanged | ✔ identical to baseline (`f35d35a`, 0 tracked changes) |
| Shared `node_modules` targets intact | ✔ main `node_modules`, `apps/web/node_modules` and `apps/web/.env.local` fingerprints identical to baseline |
| All protected worktrees registered | ✔ hpg2-goal-linked-plans, palm-g4a-scan, gov02-i0c-pr1, aura-palm-01-i1, aura-mcp-02-i1-5-b each present. Registry = baseline − 5 |
| No unexpected directories modified | ✔ `.claude/worktrees` top-level listing before/after differs **only** by `location-pr8-reliable-confirmation` (`raw/stageB_before_dirs.txt`). Stub dirs unchanged |
| Git worktree metadata consistent | ✔ 116 registered, 115 admin dirs = 115 linked worktrees, none prunable or locked, every admin `gitdir` resolves |

Measured free-space gain for this step: 541 MiB (preflight `du` 535 MiB).
