# AURA-DISK-01 — 05 Process and Ownership Review

Snapshot taken 2026-11-14 ≈16:10 local. All checks were read-only (`lsof`, `ps`, Claude desktop session listing, `.git/worktrees/*` metadata). No process was signalled; no lock was touched.

## 1. Git worktree locks
No worktree is locked (`.git/worktrees/*/locked` absent for all 120 linked worktrees).

## 2. Processes associated with worktrees

| Worktree | PID | Process | Association | Effect |
|---|---|---|---|---|
| hpg2-goal-linked-plans | 38138 | `adb -L tcp:5037 fork-server server` (up 2 d 23 h) | cwd = `apps/web/android`; 5 open files under the worktree | PRESERVE (active Android validation; also protected) |
| agitated-swanson-bb3539 | 59559 | `/bin/zsh -l` (parent: Claude desktop app helper, started 15:39 today) | cwd | PRESERVE |
| amazing-sanderson-11618a | 59871 | `/bin/zsh -l` (parent: Claude desktop app helper, started 15:39 today) | cwd | PRESERVE |

**Later observations (independent review and auditor re-check, ≈16:10–16:30):** an Android emulator (`qemu-system-aarch64 -avd Aura_Test_API34`, started 16:10, no longer running at re-check), netsimd and crashpad, and a Temurin-17 Java/Gradle process (PID 55792, started 15:31) holding open files in `hpg2-goal-linked-plans` — Android validation is live. Shell loops with cwd in the main checkout's `AURA_GOV_02_RE4_FIX01/` were also seen (evidence being produced). No process was associated with any REVIEW or REMOVAL CANDIDATE worktree in either check. Process state changes minute-to-minute; it must be re-checked immediately before any removal.

- 27 processes have the main checkout as cwd (Claude sessions and their tools) — main is protected.
- No process command line references `.claude/worktrees` (no dev server, test runner, emulator or Codex process is running against a linked worktree).
- `lsof +D .claude/worktrees` found open files only in the three worktrees above.

## 3. Claude desktop session bindings

Unarchived Claude Code desktop sessions whose working directory is a linked worktree (from the session list; none is currently running):

| Worktree | Session | Last activity | PR | Classification |
|---|---|---|---|---|
| agitated-swanson-bb3539 | "Fix remaining mislabeled timeline navigation links" | 2026-11-11 | #291 merged | PRESERVE (also live shell) |
| vigilant-spence-87b096 | "Fix Day Constructor ignoring plans that span into the day" | 2026-10-03 | #193 **closed** | PRESERVE (session ownership; review P2-3) |
| vigilant-robinson-e14d9c | two sessions (plan-day row-id; e2e cleanup race) | 2026-09-24 | none | PRESERVE (uncommitted changes) |
| loving-bardeen-cfbf42 | "Fix ambiguous Deep Work locator" | 2026-09-02 | none | PRESERVE (uncommitted changes) |
| amazing-sanderson-11618a | "Fix stale fixture dates…" | 2026-09-02 | none | PRESERVE (uncommitted change, live shell) |
| objective-albattani-f959a3 | "Remove dead CalendarView.tsx…" | 2026-08-23 | none | PRESERVE (session ownership; review P2-3) |
| objective-raman-6bdc56 | "Fix non-idempotent DB test fixtures…" | 2026-08-23 | none | PRESERVE (uncommitted changes) |

A session for `lucid-heisenberg-ed96cc` is also unarchived, but that worktree no longer exists or is registered.

Removing a worktree that an unarchived desktop session points at would leave that session without its folder. Recommended order for any later cleanup: archive the session first (the Claude app can then clean up its own worktree), not the other way around.

Worktrees named `agent-*` were created by Claude subagents (review/implementation agents). None of them has a live process. Their activity dates come from `.git/worktrees/<name>/logs/HEAD`.

Note: the `index` mtime of many worktrees reads 2026-11-12 13:23 — a repository-wide index refresh by some tool on that date, not evidence of work. Reflog dates and commit dates were used as the activity signal instead.

## 4. Cross-worktree dependencies (symlinks)

| Link (in worktree) | Target | Count |
|---|---|---|
| `node_modules` | main checkout `node_modules` (absolute or `../../../node_modules`) | 40 |
| `apps/web/node_modules` | main checkout `apps/web/node_modules` (currently an **empty** directory) | 40 |
| `apps/web/.env.local` | main checkout `apps/web/.env.local` | 4 |
| `agent-aef69a94f416506e4/node_modules` | **`hpg2-goal-linked-plans/node_modules`** | 1 |

- No worktree depends on any removal candidate or REVIEW worktree.
- hpg2-goal-linked-plans is a dependency target (protected anyway).
- Main checkout is a dependency target for 40 worktrees (protected).

## 5. Unresolved ownership

- Whether the PCE/PA/PANCH review worktrees from 2026-11-06…11-10 are closed reviews could not be determined from Git alone; they are PRESERVE or REVIEW, never candidates.
- Codex session ownership of worktrees was not determinable beyond process checks (no Codex process found).
