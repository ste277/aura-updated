# AURA-DISK-04 — 06 Future Cleanup Hold List

**All items are on HOLD. Nothing here is approved for removal.** The classifications come from AURA-DISK-01 (2026-11-14) and **must not be assumed to stay valid**. Worktree state, processes, sessions and project status change.

| Category | Approx. size | Members / detail | Status | Source |
|---|---:|---|---|---|
| 7 Tier B worktrees | 3.5 GiB | daily-briefing-db1-gochar-engine, daily-briefing-db2-api-home, daily-briefing-db3-insights, daily-briefing-db4-polish, hpg1-activity-identity, agent-a5f0d857578d03c24, agent-a105eba84b6abaafe | **HOLD** | DISK01_08 (Tier B) |
| 39 REVIEW worktrees | 11.5 GiB | daily-rhythm-dr1…dr4d (helper scripts), insights-v1-pr7 (differing `.env.local`), PCE/PA/PANCH review agents, detached agent worktrees (incl. two with local-only commits), plan-my-day-review | **HOLD** | DISK01_07 / DISK01_08 |
| 2 non-worktree folders | 4.5 MiB | `.claude/worktrees/apps`, `.claude/worktrees/agent-a8da33ba4e882df81` | **HOLD** | DISK01_03 §1 |
| `~/Library` developer caches | 8.1 GiB | CoreSimulator dyld cache 3.5, Codex Sparkle update cache 2.6, Homebrew downloads 2.0 | **HOLD** | DISK01_09 |
| Build-cache-only cleanup (`.next`/`.next-dev`) in REVIEW worktrees | up to ≈6.9 GiB | would delete regenerable build output only, keeping the worktrees. Overlaps the REVIEW row's size, so do not add the two | **HOLD** | DISK01_08, DISK03_FINAL |

Not candidates (preserve): the 35 PRESERVE rows (34 linked worktrees + the main checkout), iOS DeviceSupport (6.9 GiB, iPhone on iOS 26.6.1), simulator devices, Android AVD.

## Preconditions for any future cleanup
1. A **fresh inventory** (DISK-01-style), not reuse of these lists.
2. **Current** worktree-status, process (`lsof` cwd and open files) and Claude/Codex session checks, immediately before action.
3. Confirmation that branches and commits are preserved (reachability, no reflog-only commits, local-only commits identified).
4. **Explicit owner approval of the exact targets.**
5. A **separate execution ticket** with the DISK-03 safeguards plus the DISK04_04 procedural improvements.
