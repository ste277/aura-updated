# AURA-DISK-01 — Final Gate Report

**Gate decision: CONDITIONAL PASS**
**Date:** 2026-11-14 · **Auditor:** Claude (AI) · **Independent review:** separate Claude (AI) subagent — no human verification claimed.
**No cleanup was performed. Nothing in any worktree, Git metadata, cache or simulator was modified.**

## Gate criteria

| AUDIT PASS requirement | Result |
|---|---|
| Complete registered-worktree inventory | ✔ 121 registered (main + 120); 0 locked / prunable / missing; 2 unregistered stub dirs recorded |
| All protected worktrees preserved | ✔ main, hpg2-goal-linked-plans, palm-g4a-scan, gov02-i0c-pr1, aura-palm-01-i1, aura-mcp-02-i1-5-b = PRESERVE |
| Working-tree and commit-state checks | ✔ all 121 (against local main **and** origin/main) |
| Ignored and untracked content assessed | ✔ 317 ignored entries sized; untracked files hashed vs main/Git |
| Conservative classification | ✔ PRESERVE 35 · REVIEW 39 · REMOVAL CANDIDATE 47 |
| Storage estimates documented | ✔ with APFS caveats |
| Independent review completed | ✔ agrees with all 47 candidates; no P0 |
| No unresolved P0/P1 affecting retention safety | ✔ P1-1/P1-2 are pre-removal procedural safeguards, adopted in 08; neither changes any classification |
| Manifest verified | ✔ `shasum -a 256 -c SHA256SUMS` (see below) |

**Why CONDITIONAL and not full PASS:** 39 worktrees remain REVIEW and need owner investigation (Panchangam reviews possibly still open, detached agent worktrees, helper scripts, one differing `.env.local`, closed-unmerged PR #248). Remote refs date from the 2026-11-11 fetch, and the ticket's "HPG4 is current" premise conflicts with `origin/main` (#277 HPG4 Closure). This matches the ticket's CONDITIONAL PASS definition. The 47 removal candidates themselves are verified.

## Summary figures

| Item | Value |
|---|---|
| Registered worktrees | 121 (120 linked + main) |
| Worktree storage | 31.69 GiB (34.0 GB) in `.claude/worktrees`; main checkout +1.26 GiB |
| Of which regenerable build output / dependencies | 19.87 GiB `.next*` · 9.98 GiB `node_modules` |
| PRESERVE / REVIEW / REMOVAL CANDIDATE | 35 / 39 / 47 |
| Conservative recovery (40 Tier A) | 7.72 GiB reported (planning 6.9–7.7 GiB) |
| Moderate recovery (47 candidates + 10 owner-reviewed) | 16.38 GiB (planning 14.7–16.4 GiB) |
| Maximum reviewed (47 + all 39 REVIEW) | 22.69 GiB (planning 20.4–22.7 GiB) |
| Additional `~/Library` cache candidates | ≈8.1 GiB (CoreSimulator dyld 3.5, Codex Sparkle 2.6, Homebrew downloads 2.0); DeviceSupport 6.9 GiB preserved (iPhone iOS 26.6.1) |
| Current free space | 25.2 GB "Capacity Not Allocated" (df: 23.5 GiB available) |

## Work or evidence at risk if handled carelessly (all PRESERVE)
- Staged changes in six agent worktrees (largest: agent-a6d98d55041986ead, 21 files incl. CI workflow) and modified files in hpg2 (35), vigilant-robinson (4), loving-bardeen (3), objective-raman (2), amazing-sanderson (1).
- Three audit reports that exist nowhere else: `AURA_HPG0_HOME_PLAN_GOALS_INTEGRATION_AUDIT.md` (hpg0-audit), `AURA_DR4_HOME_PLAN_EXPERIENCE_AUDIT.md` (daily-rhythm-dr3-candidate-coverage), `AURA_DAILY_RHYTHM_V1_ARCHITECTURE_AUDIT.md` (location-pr9-unified-onboarding-confirmation).
- Local-only (never pushed) commits: 2 on `worktree-hpg4-2-ci-functional-hardening` (agent-a7a5f4de), 5/2 on `home-intent-1-ask-aura-handoff` / `pr284-*` (agent-ae0a83fb, agent-a2ee4c50). Safe only while those local branches are kept.
- Stash `stash@{0}` (pce4a-lahiri-ayanamsa-epoch-fix) and two `refs/codex` checkpoints — repo-wide, unaffected by worktree removal.
- No REMOVAL CANDIDATE holds a unique commit, uncommitted change, unique untracked or ignored file.

## Largest safe candidates
insights-v1-pr6-durable-completion-attribution (757 MiB), daily-briefing-db2-api-home (771), daily-briefing-db4-polish (770), daily-briefing-db3-insights (767), daily-briefing-db1-gochar-engine (632), location-pr8-reliable-confirmation (535), hpg1-activity-identity (382), insights-v1-pr4 (321), goal-planning-handoff-v1 (312), insights-v1-pr5 (305).

## Other observations for the owner
- Local `main` is 49 commits behind `origin/main`.
- A macOS update appears staged (`com.apple.os.update-MSUPrepareUpdate` snapshot; Preboot volume 10.8 GB).
- Android validation is live in hpg2 (adb, Gradle/Java; emulator seen at 16:10).

## Recommended next owner decision
Approve (or decline) **retirement of the 40 Tier A worktrees (≈7.7 GiB)** as a first, separately authorised ticket, executed with the 08 safeguards (fresh process check per worktree, status check before `--force`, keep branches, measure free space before/after). Separately decide whether to clear the ≈8.1 GiB of `~/Library` caches and/or the `.next` build caches in REVIEW worktrees, which together with Tier A would give ≈20+ GiB without touching any REVIEW or PRESERVE work.

## Post-audit state check
The Git collector was re-run at the end of the audit and compared with the first run. All 118 non-protected worktrees: **identical** (branch, HEAD, modified, staged, untracked, ignored, reachability counts). Only untracked counts grew in three protected worktrees, from other active work: MAIN 332→358 (22 of these are this `AURA_DISK_01/` package), hpg2-goal-linked-plans 424→498, palm-g4a-scan 124→141. This confirms those worktrees are actively producing evidence. Main HEAD still `f35d35a`; 121 worktrees still registered.

## Manifest
`SHA256SUMS` covers every file in this package, including `raw/`. Verified with `shasum -a 256 -c SHA256SUMS` from inside `AURA_DISK_01/`.
