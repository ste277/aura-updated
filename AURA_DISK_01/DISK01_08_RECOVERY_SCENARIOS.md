# AURA-DISK-01 — 08 Recovery Scenarios

**No scenario is authorised.** These are estimates to support a later owner decision. Protected and PRESERVE worktrees are never counted.

Final classification (after independent review): **PRESERVE 35 · REVIEW 39 · REMOVAL CANDIDATE 47** (121 registered).
Sizes are `du` allocated blocks; planning range assumes 90–100 % physical recovery (see 06 §4). 1 GiB = 1.074 GB.

## Ranking of removal candidates
Ranked by (1) confidence, (2) size, (3) no current project dependency, (4) ease of recovery. Every candidate is recoverable by re-creating the worktree from its surviving branch (`git worktree add`) plus `npm ci`; nothing unique is lost.

Tier A — highest confidence (40): HEAD is an ancestor of `origin/main`, branch attached, no activity since before 2026-10-15, clean, no unique untracked/ignored content, no session/process, nobody links into it. Largest: `insights-v1-pr6-durable-completion-attribution` 757 MiB, `location-pr8-reliable-confirmation` 535 MiB, `insights-v1-pr4-goal-planning-reporting` 321 MiB, `goal-planning-handoff-v1` 312 MiB, `insights-v1-pr5-evidence-backed-suggestions` 305 MiB, `complete-from-home` 289 MiB, `home-recomposition` 282 MiB, `home-move` 280 MiB … down to the four 9 MiB `day-constructor-v1-pr-d/e1/e2/e3`.

Tier B — candidates with one extra verified condition (7):

| Worktree | Size | Condition |
|---|---|---|
| daily-briefing-db2-api-home | 771 MiB | HEAD squash-equivalent to merged #260 (zero diff verified), held by `origin/worktree-daily-briefing-db2-api-home` |
| daily-briefing-db4-polish | 770 MiB | In origin/main; last activity 2026-10-22 |
| daily-briefing-db3-insights | 767 MiB | In origin/main; last activity 2026-10-22 |
| daily-briefing-db1-gochar-engine | 632 MiB | Squash-equivalent to merged #259 (zero diff verified) |
| hpg1-activity-identity | 382 MiB | In origin/main; HPG1 complete (not current HPG track) |
| agent-a5f0d857578d03c24 | 241 MiB | Squash-equivalent to merged #289 (zero diff verified); review agent from 2026-11-06 |
| agent-a105eba84b6abaafe | 18 MiB | In origin/main (#286); agent from 2026-11-05 |

## Scenarios

| Scenario | Worktrees | Reported | Planning range (physical) | Status |
|---|---|---|---|---|
| **Conservative** | Tier A (40) | **7.72 GiB** (8.3 GB) | 6.9–7.7 GiB | Verified candidates; independent review agrees |
| **Moderate** | Tier A + Tier B (47) + 10 owner-reviewed REVIEW rows below | **16.38 GiB** (17.6 GB) | 14.7–16.4 GiB | 47 verified + 5.16 GiB conditional on owner sign-off |
| **Maximum reviewed** | All 47 candidates + all 39 REVIEW rows | **22.69 GiB** (24.4 GB) | 20.4–22.7 GiB | Conditional; each REVIEW row needs its own verification |

Moderate's owner-reviewed additions (all have HEAD in origin/main and a merged PR or none needed):

| Worktree | Size | Owner action needed first |
|---|---|---|
| daily-rhythm-dr1, dr2, dr4a, dr4b, dr4b1, dr4b2, dr4c (7) | 4.55 GiB | Keep one copy of `run_ts.sh` (and `run_rhythm_sweep.sh` from dr2) somewhere, or confirm they are disposable |
| agent-afbaea6d097e013fb, agent-a8ba1128b15658d87, plan-my-day-review (detached, HEAD in origin/main) | 0.61 GiB | Confirm the detached review is finished |

Maximum-reviewed adds the remaining REVIEW rows, which need: Panchangam reviews confirmed closed (PCE/PA/PANCH agent worktrees, 2026-11-06…11-10); `insights-v1-pr7` `.env.local` reconciled; `daily-rhythm-dr4d-full-day-timeline-nav` and its closed-unmerged PR #248 decided; detached worktrees with local-only commits (agent-ae0a83fb, agent-a2ee4c50) kept only if their local branches (`home-intent-1-ask-aura-handoff`, `pr284-*`) are retained.

Not counted anywhere: PRESERVE rows (10.27 GiB incl. main), `.git/objects` (worktree removal frees nothing there), and the two unregistered stub dirs (4.5 MiB, need plain deletion rather than `git worktree remove`).

## Alternatives outside worktree retirement (separate authorisation)

| Option | Approx. | Notes |
|---|---|---|
| Delete only `.next`/`.next-dev` build caches in REVIEW + candidate worktrees | up to 15.15 GiB | Keeps every worktree, branch, index and untracked file; builds regenerate. Overlaps the scenarios above, so do not add the two |
| `~/Library` developer caches (CoreSimulator dyld, Homebrew downloads, Codex Sparkle) | ≈8.1 GiB | See 09; DeviceSupport, simulator devices and AVD excluded |

Example combination: Conservative removal (7.7 GiB) + build caches in REVIEW rows (≈6.9 GiB) + `~/Library` caches (8.1 GiB) ≈ 22.7 GiB without touching any REVIEW or PRESERVE worktree's source, index or evidence.

## Mandatory safeguards for any later cleanup (from independent review)
1. Immediately before each removal, re-run `lsof -a -d cwd` and `lsof +D <worktree>`; abort if anything is found.
2. 35 of the 47 candidates show `?? node_modules` / `?? apps/web/node_modules` (symlinks), so `git worktree remove` will require `--force`, which also skips the clean-tree check. Before each forced removal confirm `GIT_OPTIONAL_LOCKS=0 git status --porcelain --ignored` shows nothing beyond those symlinks and regenerable build output.
3. Do not delete local branches as part of worktree removal (they hold the commits).
4. Archive bound Claude desktop sessions before touching their worktrees.
5. Record `diskutil apfs list` "Capacity Not Allocated" before and after; report actual recovery, not the `du` estimate.
