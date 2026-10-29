# AURA-DISK-01 — 06 Storage Breakdown

Units: GiB/MiB are binary (1 GiB = 1,073,741,824 B). macOS Finder/Disk Utility show decimal GB (×1.074).
Source data: `raw/storage.tsv`, `raw/ignored.tsv`. Measured with `du -sk` (allocated blocks, symlinks not followed).

## 1. Totals

| Scope | Size |
|---|---|
| `.claude/worktrees/` (single `du`) | **31.69 GiB** (34.03 GB) |
| Sum of 120 per-worktree measurements | 31.69 GiB — equal to the single `du`, so **no hard-link sharing** between worktrees |
| Main checkout excl. worktrees | 1.26 GiB (of which `.git` 0.68 GiB, `apps/web/.next` 0.37 GiB) |
| Unregistered dirs (`agent-a8da33ba…`, `apps`) | 4.5 MiB |

## 2. By category (120 linked worktrees)

| Category | Size | Share | Regenerable? |
|---|---|---|---|
| Next.js build output (`apps/web/.next`, `.next-dev`) | **19.87 GiB** | 63 % | Yes — `next build` / `next dev` |
| Real `node_modules` copies (root + `apps/web`) | **9.98 GiB** | 31 % | Yes — `npm ci` from `package-lock.json` |
| Other ignored (Android build, `vendor`, MCP `dist`, model files…) | 0.10 GiB | <1 % | Mostly yes; in protected worktrees |
| Untracked content | 0.11 GiB | <1 % | **No** — includes evidence (mainly palm-g4a-scan, hpg2) |
| Tracked source checkout + `.git` file | ≈1.65 GiB | 5 % | Yes — recreatable from Git (≈14–19 MiB each) |

Typical worktree footprints:
- "Fat" worktree with its own `node_modules` and a build: ≈740–810 MiB (≈409 MiB deps + 320–390 MiB `.next` + ≈16 MiB source).
- Agent worktree with partial deps (64 MiB) and one build: ≈295 MiB.
- Worktree with symlinked deps and one build: ≈140–290 MiB.
- Source only: 9–19 MiB.

## 3. By classification

| Class | Count | Total | `node_modules` | `.next*` | Unique untracked | Source |
|---|---|---|---|---|---|---|
| PRESERVE (excl. main) | 34 | 9.00 GiB | 3.65 | 4.71 | 0.10 | 0.45 |
| REVIEW | 39 | 11.47 GiB | 3.82 | 6.98 | ≈0 | 0.67 |
| REMOVAL CANDIDATE | 47 | 11.22 GiB | 2.51 | 8.17 | 0 | 0.53 |

Largest single directories: hpg2-goal-linked-plans 1.19 GiB (protected), then fourteen ≈0.73–0.79 GiB worktrees (`daily-briefing-db*`, `daily-rhythm-dr*`, `insights-v1-pr6`, `location-pr9`, `agitated-swanson`).

## 4. Logical vs physical recovery (APFS)

Reported figures are allocated blocks per `du`. The physical space actually freed may differ:

| Factor | Finding | Effect on estimate |
|---|---|---|
| Hard links | None across worktrees (aggregate `du` = sum of parts) | No reduction |
| Symlinked `node_modules` | Not counted by `du` (links only) | Already excluded; deleting a worktree does not touch the target |
| APFS clones (shared extents) | Not measurable with read-only standard tools. `git checkout` and `npm install` normally write new files, not clones; a worktree copied with `cp -c` or Finder duplicate would share extents | If any clones exist, freed space is **lower** than reported |
| Local snapshots | `tmutil listlocalsnapshots /` shows only `com.apple.os.update-*` snapshots (incl. `MSUPrepareUpdate`); no Time Machine local snapshots | Data-volume deletions should be freed promptly. The `os.update` snapshots relate to a prepared macOS update (Preboot volume 10.8 GB) and are out of scope |
| Purgeable / delayed reclamation | APFS may report freed space with a delay | Measure free space before and after |

**Working assumption:** physical recovery ≈ 90–100 % of the `du` figure for removal candidates. Treat the lower bound as the planning number and verify with `diskutil apfs list` ("Capacity Not Allocated") before and after any owner-authorised cleanup.

## 5. Observation: build caches dominate

20 GiB of the 31.7 GiB is Next.js build output. Deleting only `.next`/`.next-dev` in non-protected worktrees (without removing any worktree) would recover up to ≈15.2 GiB and keeps every branch, index and untracked file intact. This is an **alternative** that needs its own owner authorisation; it is not part of the worktree-retirement scenarios in 08 and nothing was deleted.
