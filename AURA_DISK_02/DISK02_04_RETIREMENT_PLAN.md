# AURA-DISK-02 — 04 Retirement Plan (NOT EXECUTED)

**Status: proposal for owner approval. Nothing below has been run.** Per-row detail (path, branch, HEAD, size, every check, method, prerequisites) is in `DISK02_02_TIER_A_PREFLIGHT.csv`.

## 1. Scope
- **40 eligible Tier A worktrees**, 7.72 GiB by `du` (planning range 6.9–7.7 GiB physical; see DISK-01 06 §4).
- Risk: **LOW** for all 40. Each is clean, its HEAD is in `origin/main`, its branch is retained, it holds no unique files, no process or session uses it, and nothing links into it.
- Out of scope, never touched: the other 81 worktrees, all branches, `.git/objects`, the main checkout's `node_modules` and `.env.local`, the `.claude/worktrees/{apps,agent-a8da33ba…}` stub dirs, all caches.

## 2. Order

| # | Worktree | MiB | Method |
|---|---|---|---|
| 1–4 | day-constructor-v1-pr-d, -e1, -e2, -e3 (**canaries**) | 9.3–9.5 each | M1 |
| 5 | location-pr8-reliable-confirmation (**M2 canary**) | 535.2 | M2 |
| 6 | insights-v1-pr6-durable-completion-attribution | 756.5 | M2 |
| 7 | insights-v1-pr4-goal-planning-reporting | 321.1 | M1 |
| 8 | goal-planning-handoff-v1 | 312.4 | M1 |
| 9 | insights-v1-pr5-evidence-backed-suggestions | 304.7 | M1 |
| 10 | complete-from-home | 289.4 | M1 |
| 11 | home-recomposition | 281.8 | M1 |
| 12 | home-move | 280.3 | M1 |
| 13 | day-driven-right-now | 272.1 | M1 |
| 14 | missed-recovery | 257.1 | M1 |
| 15 | plan-day-row-identity | 251.3 | M1 |
| 16 | plan-my-day-ux-v2-u2 | 241.2 | M1 |
| 17 | home-quick-capture | 237.6 | M1 |
| 18 | quick-capture-planning | 236.9 | M1 |
| 19 | day-constructor-v1-pr-f2 | 215.1 | M1 |
| 20 | move-domain | 175.5 | M1 |
| 21 | scheduling-mode | 175.1 | M1 |
| 22 | recomposition-acceptance | 174.0 | M1 |
| 23 | skip-domain | 170.0 | M1 |
| 24 | recomposition-proposal | 163.1 | M1 |
| 25 | quick-capture-domain | 159.2 | M1 |
| 26 | availability-context-v1-h1 | 154.9 | M1 |
| 27 | day-constructor-v1-pr-f1 | 153.2 | M1 |
| 28 | planning-horizon-v1-p1 | 151.4 | M1 |
| 29 | fix-home-plan-add-actions | 151.4 | M1 |
| 30 | availability-context-v1-h2 | 151.3 | M1 |
| 31 | intent-priority-deadline-capture | 149.4 | M1 |
| 32 | fix-day-constructor-fixed-reservation | 149.0 | M1 |
| 33 | fix-natural-intent-duration-fallback | 149.0 | M1 |
| 34 | day-constructor-v1-pr-c | 140.2 | M1 |
| 35 | day-constructor-v1-pr-b | 140.0 | M1 |
| 36 | day-constructor-v1-pr-a | 139.9 | M1 |
| 37 | home-ia-v2-followups | 139.8 | M1 |
| 38 | planning-horizon-v1-p2 | 113.2 | M1 |
| 39 | plan-my-day-ux-v2-u1 | 94.6 | M1 |
| 40 | home-skip | 80.7 | M1 |

The four canaries are tiny and use the commonest method (M1). `location-pr8` is the canary for M2, the only path that deletes a real `node_modules` and a regular `.env.local` file (independent review P3-1). After it, pause: confirm main's `node_modules`, `apps/web/node_modules` and `apps/web/.env.local` are unchanged (same `ls -ld` and SHA-256 of the env file), and that free space rose by roughly 0.5 GiB. Only then continue with `insights-v1-pr6`. If any canary behaves unexpectedly (refusal, error, unexpected free-space change, any change to main), stop the whole run. After the canaries, the largest worktrees go first so that a partial run still recovers the most space.

## 3. Per-worktree gate (run immediately before each removal; any failure ⇒ skip that worktree and record it; independent review P2-2)

All checks are read-only. `W` = absolute path from the CSV, `B` = branch, `H` = HEAD SHA.

1. `git worktree list --porcelain` still shows `W` with `HEAD H` and `branch refs/heads/B`, not locked.
2. `git rev-parse refs/heads/B` = `H`, and `git merge-base --is-ancestor H 1741a95a3bc5c364f71a743442a8e31557756c33` succeeds.
3. `GIT_OPTIONAL_LOCKS=0 git -C W status --porcelain=v1 --untracked-files=all` prints **exactly** `?? apps/web/node_modules` and `?? node_modules` (M1) or **nothing** (M2).
4. `GIT_OPTIONAL_LOCKS=0 git -C W status --porcelain=v1 --ignored=matching` shows no ignored entry beyond those in the CSV `ignored_entries` column.
5. `lsof -a -d cwd` shows no process with cwd at or under `W`, and `lsof +D W` returns nothing.
6. No Claude/Codex session uses `W` (session list).

## 4. Methods

**M1 — symlink-holding worktrees (38).** Keeps Git's clean-tree check active; no `--force`.
```
ROOT=/Users/stephen/Desktop/Claude/auraschedule-math-core
# guard: must be a symlink AND must resolve exactly to main's directory (independent review P2-1)
test -L "W/node_modules" && [ "$(cd "W" && cd "$(dirname "$(readlink node_modules)")" && pwd -P)/$(basename "$(readlink "W/node_modules")")" = "$ROOT/node_modules" ] && unlink "W/node_modules"
test -L "W/apps/web/node_modules" && [ "$(cd "W/apps/web" && cd "$(dirname "$(readlink node_modules)")" && pwd -P)/$(basename "$(readlink "W/apps/web/node_modules")")" = "$ROOT/apps/web/node_modules" ] && unlink "W/apps/web/node_modules"
git -C "$ROOT" worktree remove "W"
```
- `unlink` on a symlink removes only the link. `test -L` guarantees neither path is a real directory, and the resolution check guarantees the link is the expected one into main. If either guard fails, stop: do not unlink anything else.
- Never add a trailing slash (`node_modules/`), and never use `rm -r`/`rm -rf` on these paths. Either would act on the **target**, main's shared `node_modules`.
- If `git worktree remove` refuses after the links are gone, something new has appeared. Stop, do **not** retry with `--force`, recreate the two links (05 §2) and re-audit that worktree.

**M2 — `insights-v1-pr6-durable-completion-attribution`, `location-pr8-reliable-confirmation`.**
```
git -C /Users/stephen/Desktop/Claude/auraschedule-math-core worktree remove "W"
```

**Never used:** `git worktree remove --force`, `git worktree prune`, `git branch -d/-D`, `rm -rf`, `git clean`, `git gc`.

`git worktree remove` deletes the worktree directory, including ignored `.next`, `.next-dev` and any real `node_modules`. Symlinks inside it, including `.next/standalone/node_modules`, are unlinked, never followed. It also deletes the admin dir `.git/worktrees/<name>`, including the worktree's `logs/HEAD` (no unique commits), `COMMIT_EDITMSG` and, for insights-v1-pr4/-pr5/-pr6 and location-pr8, a Claude `CLAUDE_BASE` file holding a commit id. All are disposable (independent review P3-3). No Tier A admin dir has a `config.worktree`, and no worktree-local refs exist. Branch `B` and all objects stay.

Deferred, out of scope: the unregistered stubs `.claude/worktrees/apps` (target of 8 Tier A `.next/standalone/node_modules` links; those links go away with the worktrees) and `.claude/worktrees/agent-a8da33ba4e882df81` (review P3-2). They need a separate decision and plain deletion, not `git worktree remove`.

## 5. Run-level safeguards
- Record `diskutil apfs list` "Capacity Not Allocated" and `df -k /` before the canaries, after the canaries and at the end. Report the measured recovery, not the `du` estimate.
- Re-check the full process list once at the start. Do not terminate Gradle (55792), adb, Claude, Codex or emulator processes. They are in protected worktrees, and Tier A does not need them stopped.
- Capture `git worktree list --porcelain` and `git for-each-ref refs/heads` before and after. The after state must show exactly the removed paths missing and **no** branch missing.
- Keep a per-worktree log: gate results, commands run, exit codes.
- Do not fetch, pull, merge, reset or switch branches during the run.

## 6. Expected recovery
- `du` total: 7.72 GiB (7,907 MiB). The two M2 worktrees alone account for 1.26 GiB.
- Planning range: 6.9–7.7 GiB physical. APFS clones, if any exist, would reduce it. No Time Machine local snapshots were present in DISK-01.
- Free space before: 25.2 GB "Capacity Not Allocated". Expected after: ≈32.6–33.5 GB.
