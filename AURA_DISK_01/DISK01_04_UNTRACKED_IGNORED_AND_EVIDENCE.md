# AURA-DISK-01 — 04 Untracked, Ignored and Evidence Content

Source data: `raw/untracked.tsv` (every non-symlink untracked file in a non-main worktree, SHA-256 prefix, comparison with main), `raw/ignored.tsv` (every ignored top-level entry with size).

## 1. Untracked content

Untracked files were hashed and compared with (a) the same path in the main checkout and (b) the same path in `main`'s tree. File contents were not printed.

### Evidence / reports that exist ONLY in one worktree (not in Git, not in main)

| Worktree | File | SHA-256 (prefix) | Effect on classification |
|---|---|---|---|
| hpg0-audit | `AURA_HPG0_HOME_PLAN_GOALS_INTEGRATION_AUDIT.md` | 6c7af494ab5d | PRESERVE |
| daily-rhythm-dr3-candidate-coverage | `AURA_DR4_HOME_PLAN_EXPERIENCE_AUDIT.md` | 32d1ad7c7abb | PRESERVE |
| location-pr9-unified-onboarding-confirmation | `AURA_DAILY_RHYTHM_V1_ARCHITECTURE_AUDIT.md` | 3e6d7189be5e | PRESERVE |
| hpg2-goal-linked-plans (protected) | AURA_MOBILE_01_M2_C/M2_D reports (≈13+), 18 untracked test paths, 12 under `apps/` | — | PRESERVE |
| palm-g4a-scan (protected) | AURA_PALM_01_G4_B2C/B2D evidence incl. SHA256SUMS manifests, `research/` | — | PRESERVE |

None of the three non-protected audit reports has a copy anywhere in Git history (`git log --all -- <file>` empty) or in the main checkout. Removing those worktrees would destroy them.

### Untracked helper scripts not in Git

| File | SHA-256 | Copies | Worktrees |
|---|---|---|---|
| `run_ts.sh` (127 bytes) | 50310bc281ef | 11 identical | daily-rhythm-dr1, dr2, dr3, dr4a, dr4b, dr4b1, dr4b2, dr4c, dr4d, dr4d-m1-preflight-readonly, location-pr9 |
| `run_rhythm_sweep.sh` | 0de59c9bf2fb | 1 | daily-rhythm-dr2-work-aware-scheduling |

Low value but not reproducible from Git; these worktrees are REVIEW (owner to decide whether to keep one copy of each).

### Untracked files identical to the main checkout
`agitated-swanson-bb3539`: `AURA_DAILY_BRIEFING_V1_FEASIBILITY_AUDIT.md`, `AURA_DB0_GOCHAR_RULE_PROVENANCE.md` — byte-identical to main's copies (not unique).

### Untracked symlinks
40 worktrees show `node_modules` / `apps/web/node_modules` as untracked because they are **symlinks** (the `.gitignore` pattern `node_modules/` does not match a symlink). They point at the main checkout (or, in one case, at hpg2-goal-linked-plans). Removing the worktree removes only the link, not the target. See 05 §4.

## 2. Ignored content

317 ignored top-level entries were measured. By name (non-main worktrees):

| Entry type | Size | Nature |
|---|---|---|
| `apps/web/.next` | 14.75 GiB | Next.js production/dev build output — regenerable |
| `node_modules` (real dirs, root + `apps/web`) | 9.98 GiB | npm install output — regenerable from `package-lock.json` |
| `apps/web/.next-dev` | 5.12 GiB | Next.js dev build cache — regenerable |
| `vendor`, `build`, `.gradle`, `dist`, `tsconfig.tsbuildinfo`, `testdata`, `hand_landmarker.task` | ≈0.10 GiB | Mostly in protected worktrees (hpg2 Android build, palm-g4a-scan model/testdata, MCP `dist`) |
| `.env.local` files | <0.1 MiB | Local configuration (possibly secret) — see below |
| `playwright-report/`, `test-results/` | 0.5 MiB | vigilant-robinson-e14d9c only |
| `.claude/settings.local.json` | 4 KiB | objective-albattani-f959a3 only |

### `.env.local` files (hash comparison only; contents not read)

- 16 real `apps/web/.env.local` copies are byte-identical to main's `apps/web/.env.local` (90d4416fa91e) — not unique.
- 4 further worktrees symlink `apps/web/.env.local` to main's copy.
- **Differ from main (unique local config):**
  - `insights-v1-pr7-product-completion-corrections/apps/web/.env.local` (20c702cef773) → REVIEW
  - `vigilant-robinson-e14d9c/apps/web/.env.local` (1c5319a13c52) and `.env.local` (ae7074304c07; same hash as main's root `.env.local`) → already PRESERVE for other reasons

Owner should confirm whether the differing `insights-v1-pr7` env file holds anything not available elsewhere (e.g. a test DB URL) before that worktree is retired.

## 3. Evidence directories

Every worktree contains the tracked `AURA_DAILY_BRIEFING_V1_FEASIBILITY_AUDIT.md` / `AURA_DB0_GOCHAR_RULE_PROVENANCE.md` (tracked in Git — preserved by Git). Untracked evidence exists only in MAIN, hpg2-goal-linked-plans, palm-g4a-scan and the three worktrees listed in §1. No `reports/`, `artifacts/` or `*EVIDENCE*` directories exist in any non-protected worktree.

The main checkout's 332 untracked entries (AURA_GOV_02_*, AURA_PALM_01_*, AURA_MCP_02_* etc.) are outside the scope of removal — the main checkout is protected.

## 4. Unreadable paths / incomplete scans

- No `du` or `git status` errors were returned for any worktree.
- File-level APFS clone status could not be determined (see 06).
