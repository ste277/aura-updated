# AURA-DISK-03 — 02 Approved Worktree List

**Source:** `AURA_DISK_02/DISK02_02_TIER_A_PREFLIGHT.csv` (manifest-verified), used verbatim. The list was **not** regenerated from directory names, and no replacement candidates were selected.

## Fidelity checks (before execution)

| Check | Result |
|---|---|
| Rows / unique names | 40 / 40 |
| Equal to DISK-01 rule (REMOVAL CANDIDATE ∧ HEAD ∈ origin/main ∧ last activity < 2026-10-15) | yes, exact set |
| Path, branch and HEAD identical to DISK01_02 inventory | yes, all 40 |
| All marked ELIGIBLE in DISK-02 | yes |
| Methods | M1 ×38, M2 ×2 (location-pr8, insights-v1-pr6) |

## Execution order (as recorded in DISK-02)

| Stage | # | Worktree | Method | Preflight MiB |
|---|---|---|---|---|
| A | 1 | day-constructor-v1-pr-d | M1 | 9.3 |
| A | 2 | day-constructor-v1-pr-e1 | M1 | 9.4 |
| A | 3 | day-constructor-v1-pr-e2 | M1 | 9.4 |
| A | 4 | day-constructor-v1-pr-e3 | M1 | 9.5 |
| B | 5 | location-pr8-reliable-confirmation | M2 | 535.2 |
| C | 6 | insights-v1-pr6-durable-completion-attribution | M2 | 756.5 |
| C | 7–40 | insights-v1-pr4 … home-skip (largest first; `raw/stageC_list.txt`) | M1 | 80.7–321.1 |

Full per-row detail (absolute path, branch, HEAD, checks, method, recovery prerequisites) is in the DISK-02 CSV. Per-row outcomes are in 03, 04 and 05.

## Not in scope (untouched)
The 81 other registered worktrees, including all PRESERVE rows (HPG/HPG4, mobile/Android, PALM, GOV, MCP, Panchangam, session-bound) and all REVIEW and Tier B rows. Also untouched: the two non-worktree stub folders, all branches and remote refs, and all caches and Xcode/simulator data.
