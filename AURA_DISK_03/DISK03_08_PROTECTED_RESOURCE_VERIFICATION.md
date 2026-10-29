# AURA-DISK-03 — 08 Protected Resource Verification

Final state captured 16:44 (`raw/final_worktree_list.txt`), compared with `raw/baseline_*`.

## 1. Registry

| Check | Result |
|---|---|
| Registered worktrees | **81** (main + 80 linked) |
| Baseline − final | exactly the 40 approved paths |
| Final − baseline (new entries) | 0 |
| Remaining by DISK-01 class | 35 PRESERVE, 39 REVIEW, 7 Tier B removal candidates (left untouched as instructed) |
| HEAD of each remaining worktree vs baseline | **81/81 identical** |
| Prunable / locked entries | 0 |
| `.git/worktrees` admin dirs | 80 = linked worktrees; every `gitdir` resolves |
| Admin dirs of the 40 retired | all gone (removed by `git worktree remove`; `git worktree prune` not used) |

## 2. Named protected worktrees — all present, HEAD unchanged

main checkout · hpg2-goal-linked-plans (mobile/Android; adb and Gradle left running) · palm-g4a-scan · aura-palm-01-i1 · palm-p1-verify (PALM) · gov02-i0c-pr1 (GOV-02) · aura-mcp-02-i1-5-b · HPG4: agent-a44595b74c3791ac1, agent-aca4ff78e40016d28, agent-a7a5f4de137862e18 · all Panchangam PRESERVE/REVIEW agent worktrees · all session-bound worktrees.

## 3. Branches, commits and refs

| Check | Result |
|---|---|
| 40 original branches exist at original HEAD | **40/40** |
| Every baseline local ref (heads, tags) present at the same SHA | yes. FINAL checkpoint diffed `refs/heads` and `refs/tags`: no ref missing, none moved |
| `refs/stash` | unchanged (`stash@{0}` on pce4a-lahiri-ayanamsa-epoch-fix) |
| Remote refs | identical to baseline; no fetch, pull or push |
| `origin/main` | still `1741a95a3bc5…`. Every retired HEAD is an ancestor |

## 4. Main checkout

| Check | Result |
|---|---|
| HEAD | `f35d35ab6ed4568f58f766ce0122a3a1b471b4dc`, unchanged |
| Tracked status | 0 modified/staged, identical to baseline (checked after every single removal) |
| Untracked evidence | all 114 baseline untracked entries still exist. More have been added by other sessions, plus `AURA_DISK_03/` |
| Shared dependencies (`node_modules`, `apps/web/node_modules`, `apps/web/.env.local`) | fingerprints identical to baseline |

## 5. Evidence

| Item | Result |
|---|---|
| AURA_DISK_01 manifest | 21/21 OK after execution |
| AURA_DISK_02 manifest | 11/11 OK after execution |
| Unique audit reports in PRESERVE worktrees | SHA-256 prefixes unchanged from DISK-01: hpg0-audit `6c7af494ab5d`, daily-rhythm-dr3 `32d1ad7c7abb`, location-pr9 `3e6d7189be5e` |
| AURA_DISK_03 location | main checkout root, outside every retired path |

## 6. Non-worktree folders
`.claude/worktrees/apps` and `.claude/worktrees/agent-a8da33ba4e882df81` are both present. Their inode, mode, mtime and recursive listing hash are identical to baseline.

## 7. Not accessed
Xcode, simulators, DeviceSupport, Android AVD, global npm/Homebrew/macOS caches, PALM encrypted images, Keychain. No commit, merge, push, deployment or process termination.
