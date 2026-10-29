# AURA-DISK-01 — 10 Independent Review

**Reviewer:** a separate Claude (AI) subagent, started fresh with read-only instructions and the auditor's draft data. It re-ran its own Git, `lsof`, hash, symlink, stash and storage checks. **This is an AI review; no human verification is claimed.**

**Reviewer rule deviation (disclosed by the reviewer):** it redirected one command's output to a scratch file (`rv_files.txt`, a list of 7 repo paths) in the auditor's session scratchpad. Nothing in the repository or any worktree was written or modified.

## Verdict
- Agrees with **all 47** REMOVAL CANDIDATES; disagrees with none.
- **No P0** (no candidate would lose committed or uncommitted work).
- Reviewer's verdict on the draft: **CONDITIONAL PASS**, pending the P1 safeguards and P2 reclassifications.

## Findings and disposition

| ID | Sev | Finding | Disposition |
|---|---|---|---|
| P1-1 | P1 | Process check was a point-in-time snapshot. The reviewer saw additional processes in/around hpg2-goal-linked-plans: an Android emulator (`qemu-system-aarch64 -avd Aura_Test_API34`, started 16:10), netsimd, crashpad and a Temurin-17 Java/Gradle process (PID 55792, started 15:31) with open files in hpg2; also shell loops with cwd in the main checkout's `AURA_GOV_02_RE4_FIX01/` (evidence actively being produced). No candidate affected | Auditor re-check at ≈16:30: Java/Gradle 55792 confirmed holding files in hpg2; emulator no longer running. 05 updated. Converted into mandatory pre-removal safeguard (08). hpg2 and main already PRESERVE |
| P1-2 | P1 | 35 of 47 candidates have untracked `node_modules` symlinks, so `git worktree remove` needs `--force`, which bypasses the clean check | Safeguard added to 08 (verify status shows only symlinks immediately before any forced removal). Targets are main's `node_modules`; no other worktree links into any candidate |
| P2-1 | P2 | Remote refs date from 2026-11-11 fetch. `origin/main` contains `0579191 AURA: HPG4 Closure — Tracker Reconciliation (#277)`, so the "HPG4 is current" premise may be outdated | Recorded. Ticket rule kept (conservative). Owner to confirm current HPG track |
| P2-2 | P2 | Three candidates' HEADs are not ancestors of origin/main (db2 #260, db1 #259, agent-a5f0d857 #289). Reviewer verified zero diff between each HEAD and its squash commit (193fb12, 4000ea4, 4972426) and that each HEAD is held by an origin branch | Candidate status kept; rationale wording corrected in 07 to "squash-equivalent, zero diff verified" |
| P2-3 | P2 | `vigilant-spence-87b096` and `objective-albattani-f959a3` are bound to unarchived Claude sessions but were REVIEW while siblings were PRESERVE | **Reclassified to PRESERVE** |
| P2-4 | P2 | `agent-a44595b74c3791ac1`, `agent-aca4ff78e40016d28` (HPG4-2 #274) in REVIEW although ticket protects current HPG | **Reclassified to PRESERVE** (owner may downgrade if HPG4 is closed) |
| P2-5 | P2 | Shared-branch groups (`home-rhythm-01-i1` ×4, `home-rhythm-01-a1-f1` ×2, `panch-overlap-01-i1` ×2). Reviewer judges the "staged" changes probably stale-index artefacts left when the branch advanced from a sibling worktree | Shared-branch table already in 03 §2. Classification stays PRESERVE: whether staged diffs are stale cannot be proven read-only, and they would be destroyed by removal |
| P2-6 | P2 | Several Panchangam REVIEW rows (merged PRs #293–#332, 11-06…11-10) would be PRESERVE under the ticket if reviews are still open | Accepted as REVIEW **only** on the condition that REVIEW is never bulk-removed; stated in 08 and final gate |
| P2-7 | P2 | Storage: candidates 11,487 MiB matches CSV; no hardlinks; APFS clones invisible to `du`; three `com.apple.os.update-*` snapshots incl. `MSUPrepareUpdate`; removal frees nothing in `.git/objects` | Caveats already in 06 §4; `.git/objects` note added to 08 |
| P3-1 | P3 | Inventory complete: 121 = main + 120; 120 admin dirs resolve; none locked/prunable; 17 detached; 2 unregistered stubs need plain deletion, not `git worktree remove` | Matches 01/03 |
| P3-2 | P3 | All 17 detached HEADs reachable from ≥1 ref; agent-a2ee4c50, agent-ae0a83fb, agent-a7a5f4de held only by local branches | Matches 03 §4; branch-retention note in 08 |
| P3-3 | P3 | `stash@{0}` on `pce4a-lahiri-ayanamsa-epoch-fix` (1 file, `packages/vedic/src/panchangElements.ts`); two `refs/codex/turn-diffs/checkpoints/*` refs. Repo-wide, unaffected by worktree removal; preserve | Listed in 03 §5 |
| P3-4 | P3 | Candidates hold only node_modules/.next/.next-dev/tsbuildinfo; env files are symlinks to or identical to main; reflog/ORIG_HEAD scan found nothing reachable only from a candidate's own reflog; PRESERVE evidence in location-pr9/dr3/hpg0-audit confirmed absent from main and origin/main; `run_ts.sh` 11 identical copies | Matches 04 |
| P3-5 | P3 | agent-a105eba8 and agent-a5f0d857 appear in other session transcripts only in `git worktree list` output — no ownership. `insights-v1-pr7` `.env.local` differs from main → keep REVIEW/PRESERVE until reconciled | Kept REVIEW |

## Review coverage
Inventory completeness ✔ · Git reachability (incl. squash-equivalence) ✔ · Uncommitted and ignored preservation ✔ · Detached HEAD handling ✔ · Active-process safeguards ✔ (with P1-1 caveat) · Evidence retention ✔ · APFS estimates ✔ · Classification consistency ✔ (after P2-3/P2-4) · Risk of removing an active worktree ✔ (none among candidates).

## Open P0/P1 after disposition
- P0: none.
- P1-1 and P1-2 are procedural safeguards for a future cleanup. They do not affect the correctness of the retention classification, because no candidate had any process association or unexpected content in either the auditor's or the reviewer's checks.
