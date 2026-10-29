# AURA-DISK-02 — 03 Symlink and Process Review

Source: `raw/pf.tsv`, `raw/pfsym.tsv`. Every symlink in each Tier A worktree was found with `find <wt> -type l` (links are listed, never followed) and resolved by its parent directory.

## 1. Symlinks pointing outside a Tier A worktree

| Link (relative to worktree) | Target | Worktrees | Status (untracked/ignored) |
|---|---|---|---|
| `node_modules` | main checkout `node_modules` (50 MiB) | 38 | **untracked** |
| `apps/web/node_modules` | main checkout `apps/web/node_modules` (empty dir) | 38 | **untracked** |
| `apps/web/.next/standalone/node_modules` | main checkout `apps/web/node_modules` | 21 | inside ignored `.next` |
| `apps/web/.next/standalone/node_modules` | `.claude/worktrees/apps/web/node_modules` (the unregistered stub dir from DISK-01) | 8 | inside ignored `.next` |
| `apps/web/.env.local` | main checkout `apps/web/.env.local` | 3 | ignored |

- All outside targets exist. None points into another registered worktree.
- Symlinks inside each worktree that point inside the same worktree (e.g. `node_modules/.bin/*` in the two worktrees with real dependency copies) are deleted together with the worktree. They do not matter.
- **No target is in the removal scope.** The main checkout's `node_modules`, `apps/web/node_modules`, `apps/web/.env.local` and the `.claude/worktrees/apps` stub are all outside every Tier A path.
- Removing a symlink (`unlink`, or Git's recursive delete, which uses `lstat` and unlinks links) deletes the link only. It does not traverse into or modify the target.
- The `.claude/worktrees/apps` stub is a link target for 8 Tier A build outputs. It must stay outside Tier A scope. Removing those 8 worktrees removes the links pointing at it, not the stub itself.

## 2. Why Git's clean-tree check rejects 38 worktrees

`git worktree remove` without `--force` refuses a worktree that has untracked files or tracked modifications. The `.gitignore` pattern `node_modules/` (trailing slash) only matches directories. A **symlink** named `node_modules` is not a directory, so Git reports it as untracked (`?? node_modules`, `?? apps/web/node_modules`). Those two entries are the only untracked items in the 38 worktrees. They would make a plain `git worktree remove` fail.

`--force` would bypass this, but it would also bypass the check for any other untracked or modified file that appeared later. The plan therefore does **not** use `--force` (see 04, method M1):

1. Confirm each of the two paths is still a symlink (`test -L`).
2. `unlink` it. This removes only the link, never a directory.
3. Run plain `git worktree remove`, so Git's clean-tree check stays fully active and refuses if anything else has appeared.

The two worktrees without symlinks (`insights-v1-pr6-durable-completion-attribution`, `location-pr8-reliable-confirmation`) have real ignored `node_modules` directories. They pass Git's check as they are (method M2).

Ignored content (`.next`, `.next-dev`, real `node_modules`, `tsconfig.tsbuildinfo`, `.env.local`) is not "untracked" for this check and does not block a plain remove. The independent review (06) assessed this.

## 3. Ignored and evidence content (all 40)

- Ignored entries are limited to `apps/web/.next`, `apps/web/.next-dev`, `apps/web/tsconfig.tsbuildinfo`, real `node_modules`/`apps/web/node_modules` (2 worktrees) and `apps/web/.env.local`. **Unexpected ignored entries: none.**
- `.env.local`: 36 worktrees have none, 1 is byte-identical to main (`location-pr8`), and 3 are symlinks to main's file. **None differs.**
- Untracked non-symlink files: **0** in all 40.
- Evidence references: the only reference found anywhere (excluding `AURA_DISK_0*`) to a Tier A path is a historical mention of `insights-v1-pr4-goal-planning-reporting` in the main checkout's `AURA_INSIGHTS_PR5_ARCHITECTURE_AUDIT.md`. It records that the worktree was "not touched" during PR5. It is not an evidence dependency.

## 4. Processes (snapshot 2026-11-14 16:27)

| Check | Tier A result | Other worktrees (for context) |
|---|---|---|
| `lsof -a -d cwd` | none | adb → hpg2; Claude-spawned zsh → agitated-swanson, amazing-sanderson |
| `lsof +D .claude/worktrees` (open files) | none | adb + Temurin-17 Java/Gradle (PID 55792) → hpg2 |
| Command lines naming a Tier A path | none | — |
| Dev servers / test runners / emulator / Codex app | none running against Tier A | Codex Chrome extension host only (not repo-bound) |

No process was terminated or signalled. Process state changes quickly, so the plan requires a fresh check immediately before each removal (04 §3).

## 5. Sessions

- Claude desktop sessions (active **and** archived, via the session list): **none** has a Tier A worktree as cwd. The bound worktrees are agitated-swanson, vigilant-spence, lucid-heisenberg (no longer exists), vigilant-robinson, loving-bardeen, amazing-sanderson, objective-albattani and objective-raman. None of these is Tier A.
- Codex: no Codex CLI/app process is running against the repository. Codex's own session store was not inspected (outside authorised scope).

## 6. Project protection

No Tier A worktree name, branch or HEAD subject relates to HPG, mobile/Android/iOS, PALM, GOV, MCP, Panchangam or security work. A keyword scan matched only `day-constructor-v1-pr-e2`, a false positive ("scenar**ios**"). Tier A worktrees are Day Constructor, Home, Quick Capture, Planning Horizon, Insights PR4–6, Location PR8 and similar feature branches merged Sept–mid-Oct 2026.
