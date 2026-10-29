# AURA-DISK-04 — 02 Worktree Preservation

Current inventory: `raw/current_worktree_list.txt` (captured 16:51). Per-worktree status: `raw/current_worktree_status.tsv`, which also carries DISK-01 counts for comparison. All `git status` calls used `GIT_OPTIONAL_LOCKS=0`. No reset, checkout, stash, clean or other modification was performed, and no process was interrupted.

## 1. Inventory vs DISK-03 closing inventory
`worktree`, `HEAD`, `branch`/`detached` and `locked`/`prunable` lines compared with `AURA_DISK_03/raw/final_worktree_list.txt`: **identical**. 81 registered, 80 admin dirs, none locked or prunable. No worktree has been added, removed or moved to a new HEAD since DISK-03 closed.

## 2. Working-tree differences since DISK-01 (informational, not cleanup failures)
Tracked-modified and staged counts are unchanged in every one of the 81 worktrees. Only untracked counts changed, in three protected worktrees, all from ongoing evidence or development work:

| Worktree | Untracked (DISK-01 → now) | Explanation |
|---|---|---|
| main checkout | 332 → 434 (`--untracked-files=all`) | includes the AURA_DISK_02, 03 and 04 packages plus other sessions' evidence |
| hpg2-goal-linked-plans | 424 → 667 | active AURA-MOBILE-01 work |
| palm-g4a-scan | 124 → 162 | active PALM evidence work |

## 3. Focus worktrees

| Area | Worktree | Branch | HEAD | Tracked mod / staged / untracked | Note |
|---|---|---|---|---|---|
| HPG2 / mobile | hpg2-goal-linked-plans | feature/aura-mobile-01-m1 | 9d6b77dfad46 | 35 / 0 / 667 | adb (PID 38138) and Gradle Java (PID 55792) still running, not interrupted |
| HPG4 | agent-a44595b74c3791ac1 | worktree-agent-a44595b74c3791ac1 | 0e2928c287e9 | 0/0/0 | PRESERVE |
| HPG4 | agent-aca4ff78e40016d28 | worktree-agent-aca4ff78e40016d28 | 0e2928c287e9 | 0/0/0 | PRESERVE |
| HPG4 | agent-a7a5f4de137862e18 | (detached) | b2c54d80e30e | 0/0/0 | 2 local-only commits held by `worktree-hpg4-2-ci-functional-hardening` |
| PALM | aura-palm-01-i1 | feature/aura-palm-01-i1 | 0c8d0d65ae9e | 0/0/0 | |
| PALM | palm-g4a-scan | research/palm-g4a-scan-prototype | 1741a95a3bc5 | 0/0/162 | |
| PALM | palm-p1-verify | (detached) | aa565470ae7c | 0/0/0 | |
| GOV-02 | gov02-i0c-pr1 | gov02/i0c-pr1-db-runtime-override | 7f8dad275557 | 0/0/0 | |
| MCP | aura-mcp-02-i1-5-b | feature/aura-mcp-02-i1-5-b-node24 | 63edaf8ce280 | 0/0/0 | PR #346 |
| Panchangam | agent-a87560791b632a466 | local-f1-work | 8e6f48676545 | 0/0/0 | |
| Panchangam | agent-a5ed3753c43e9ef17 | (detached) | dcb4cc934805 | 0/0/0 | |
| Panchangam | agent-ade58a6877c49bc76 | (detached) | a0dab918e380 | 0/0/0 | (+ other PCE/PA review worktrees, all present) |
| Session-bound | agitated-swanson-bb3539 | worktree-daily-rhythm-dr4f2b-choose-my-own-time | b7c35d563562 | 0/0/2 | Claude-app zsh (PID 59559) still running |
| Session-bound | amazing-sanderson-11618a | claude/kind-austin-3ddf6d | dc6055cf8f43 | 1/0/0 | Claude-app zsh (PID 59871) still running |
| Session-bound | vigilant-robinson-e14d9c | claude/priceless-shamir-470731 | 0ec678b5cb61 | 4/0/0 | |
| Session-bound | loving-bardeen-cfbf42 | claude/loving-bardeen-cfbf42 | dc6055cf8f43 | 3/0/2 | 2 untracked are the `node_modules` symlinks |
| Session-bound | objective-raman-6bdc56 | claude/objective-raman-6bdc56 | cda16546cff7 | 2/0/0 | |
| Session-bound | vigilant-spence-87b096 | claude/vigilant-spence-87b096 | 0fffa2b9ac7f | 0/0/0 | |
| Session-bound | objective-albattani-f959a3 | claude/amazing-sanderson-11618a | 79c819579bbb | 0/0/0 | |

The staged change sets in the six PRESERVE agent worktrees (e.g. agent-a6d98d55041986ead, 21 staged) are unchanged in count.

## 4. Non-worktree folders
`.claude/worktrees/apps` and `.claude/worktrees/agent-a8da33ba4e882df81` are present, and their fingerprints are identical to the DISK-03 baseline.
