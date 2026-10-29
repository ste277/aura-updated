# AURA-DISK-01 — 03 Git Status and Reachability

Source data: `raw/git.tsv`, `raw/originmain.tsv`, `raw/prmap.tsv`; per-row values in `DISK01_02_COMPLETE_WORKTREE_INVENTORY.csv`.

## 1. Registration health

- 121 registered worktrees; every path exists; every `.git/worktrees/<name>/gitdir` points back to a matching directory.
- No worktree is locked (`locked` absent everywhere) and none is reported `prunable`.
- No submodules.
- 2 directories inside `.claude/worktrees/` are **not** worktrees (no `.git` file): `agent-a8da33ba4e882df81` (4.2 MiB — a stray `apps/web/.next-dev` webpack cache from 2026-11-09) and `apps` (0.3 MiB — a stub `apps/web/node_modules/{next,styled-jsx}` from 2026-10-13). Neither contains source or evidence. Neither is counted as a worktree.

## 2. Working-tree state (A)

| State | Worktrees |
|---|---|
| Modified tracked files | MAIN 0; **hpg2-goal-linked-plans 35**; vigilant-robinson-e14d9c 4; loving-bardeen-cfbf42 3; objective-raman-6bdc56 2; amazing-sanderson-11618a 1 |
| Staged changes | **agent-a6d98d55041986ead 21** (653+/79−, incl. `.github/workflows/ci.yml`); agent-abfd397d0a37fcc48 7; agent-a3d4e4b640ee7f45d 6; agent-a4b2c666db4dcbec1 4; agent-aef69a94f416506e4 4; agent-aed5764de511986b3 1 |
| Merge conflicts | none |
| Untracked (non-symlink) content | MAIN (332 entries — existing evidence), hpg2-goal-linked-plans (AURA_MOBILE_01_* reports, tests, apps), palm-g4a-scan (AURA_PALM_01_G4_* evidence, `research/`), plus small items listed in 04 |
| Untracked symlinks only (`node_modules`, `apps/web/node_modules`) | 40 worktrees (see 05 §4) |
| Clean (no modified/staged/non-symlink untracked) | all others |

`git status` alone does not reveal ignored content; ignored entries were collected separately with `--ignored=matching` (see 04).

### Shared branches (multiple worktrees on one branch)

Git normally forbids this; these were created with forced checkout. Each worktree has its **own index**, so staged changes are per-worktree and not visible from the others.

| Branch | Worktrees (same HEAD) | Notes |
|---|---|---|
| `home-rhythm-01-i1` @24ee304 | agent-a4b2c666 (4 staged), agent-abfd397d (7 staged), agent-aef69a94 (4 staged), agent-af350182 (clean) | Three different staged change sets on the same commit |
| `home-rhythm-01-a1-f1` @32c87e2 | agent-a47d4ac3 (clean), agent-aed5764d (1 staged) | |
| `panch-overlap-01-i1` @a80f5f7 | agent-a2504743 (clean), agent-a3d4e4b6 (6 staged) | Also HEAD of detached agent-a006b629, agent-a04e5092 |

Removing a worktree never deletes its branch, but it **does** destroy that worktree's index (staged changes).

## 3. Commit preservation (B)

Counts are commits reachable from the worktree HEAD but not from the comparison set.

| Measure | Result |
|---|---|
| HEAD is ancestor of local `main` | 63 of 121 (incl. main itself) |
| HEAD is ancestor of `origin/main` | 74 of 121 |
| HEAD not in `origin/main` | 47 (1–5 commits ahead; listed in `raw/originmain.tsv`) |
| Commits not on any **other** local branch/tag (excluding the worktree's own branch) | 16 worktrees, 1–3 commits each — **all** are on the worktree's own branch **and** on a remote ref |
| Commits not on **any remote** ref | 3 worktrees, all detached (below) |
| Branch upstream configured | only MAIN (`origin/main`, behind 49) and agent-a87560791b632a466 (`local-f1-work` → `origin/panch-overlap-01-i1`, behind 1). All other branches have no upstream configured, but their commits are present on `refs/remotes/origin/*` (pushed under a matching or different name) |

Interpretation: after `git worktree remove`, branch-attached commits remain reachable from their local branch **and** from `origin`. No branch-attached commit is solely held by a worktree.

Many HEADs not in `origin/main` belong to squash-merged PRs (the PR's head SHA matches the worktree HEAD and the PR is MERGED). `raw/prmap.tsv` maps each HEAD to a PR (87 MERGED, 2 OPEN, 2 CLOSED, 30 no PR).

Open PRs: #346 (`aura-mcp-02-i1-5-b`, protected), #344 (`hpg2-goal-linked-plans` / `feature/aura-mobile-01-m1`, protected).
Closed-unmerged PRs: #248 (`daily-rhythm-dr4d-full-day-timeline-nav`), #193 (`vigilant-spence-87b096`).

## 4. Detached worktrees (C)

17 detached worktrees. Reachability of each detached HEAD:

| Worktree | HEAD | In origin/main | Reachable from local branch | On a remote ref | Classification |
|---|---|---|---|---|---|
| agent-a7a5f4de137862e18 | b2c54d8 | no (2 ahead) | only `worktree-hpg4-2-ci-functional-hardening` | **no** (2 local-only) | PRESERVE (current HPG4) |
| agent-ae0a83fbd21ffa424 | f556552 | no (5 ahead) | `home-intent-1-ask-aura-handoff`, `pr284-p2-verify`, `pr284-rereview` | **no** (5 local-only) | REVIEW |
| agent-a2ee4c5094ce6fe6e | 25e0872 | no (2 ahead) | `home-intent-1-ask-aura-handoff`, `pr284-*` (5 branches) | **no** (2 local-only) | REVIEW |
| agent-a5ed3753c43e9ef17 | dcb4cc9 | no | yes | yes | PRESERVE (Panchangam, no merged PR) |
| agent-ade58a6877c49bc76 | a0dab91 | no | yes | yes | PRESERVE (Panchangam, no merged PR) |
| agent-a10f348b64eda1613, agent-a44feb3ce854cc4cb, agent-a7cc17647a7c83c91 | various | no | yes | yes | REVIEW |
| agent-a006b62991d1ae614, agent-a04e5092b79501756, agent-a5f26c19c490862f6, agent-a7c6e9a71a95c6d1d, agent-a249b9de5474dedf2 | various | no (merged PR head) | yes | yes | REVIEW |
| agent-a8ba1128b15658d87, agent-afbaea6d097e013fb, plan-my-day-review | various | **yes** | yes | yes | REVIEW |
| palm-p1-verify | aa56547 | no | yes | yes | PRESERVE (PALM) |

No detached worktree holds a commit unreachable from every local ref. Three hold commits that exist **only locally** (not pushed); those commits survive worktree removal only as long as their local branches are kept. Per ticket rule, no detached worktree is a removal candidate.

## 5. Other refs

- `refs/stash`: 1 entry — `stash@{0}: On pce4a-lahiri-ayanamsa-epoch-fix: pce4a-temp-before-compare-7a3f9c`. Stashes live in the common repository, not in a worktree directory, so worktree removal does not affect it; it is noted because it relates to Panchangam PCE-4A work.
- `refs/codex/turn-diffs/checkpoints/*`: 2 refs (Codex checkpoints). Repository-wide; not tied to a worktree directory.
- Tags: `v1.0.0`, `v1.1.0`.
- 398 local branches, 263 remote-tracking refs.
