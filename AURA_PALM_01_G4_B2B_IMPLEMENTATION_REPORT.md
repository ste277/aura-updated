# AURA-PALM-01-G4-B2B — Implementation Report

**Ticket:** Encrypted Storage Readiness, HEIC Safety and Final Technical Verification
**Date:** 2026-11-11 · **Dependency:** G4-B2A CONDITIONAL PASS
**Location:** `.claude/worktrees/palm-g4a-scan/research/palm-scan-g4a/` (branch `research/palm-g4a-scan-prototype`). All code is **untracked and uncommitted**. No commit, push, merge or deploy took place.

> No participant photograph was collected, imported, opened, annotated or processed. All test images were generated gradients with fake sentinel metadata. No encrypted volume was created or mounted. `~/AuraResearch` does not exist. No software was installed. No hook was installed in any real worktree.

## 1. Baseline check (before changes)
- The B2A suites re-run today gave security **61/62**. The single failure was a B2A test that only passed while a disposable volume from a previous session was still mounted, at a path hard-coded to that session's scratchpad.
- `metadata.test.sh` could **not** be re-run as shipped: it needs a Pillow generator from that scratchpad, and Pillow is not installed.
- Git guard 10/10, metrics 9/9.
- Frozen-criteria SHA `bcc8f204…ee43a9`: unchanged.

B2A's "105/105" was therefore not fully reproducible. Both gaps are fixed below.

## 2. Changes by task (research code only)
| Task | Change | Files |
|---|---|---|
| A | Owner setup procedure: two AES-256 images, separate passphrases, `-stdinpass` hidden prompts (no CLI or keychain passphrases), `-nobrowse -noautoopen -owners on`, Spotlight off, verification and rollback | `AURA_PALM_01_G4_B2B_ENCRYPTED_STORAGE_SETUP_GUIDE.md` |
| B | Guard requires the exact mount point `/Volumes/PALM_G4B_DATA` (`UNEXPECTED_MOUNT_POINT`). 7 new simulated failure cases. New self-contained real-volume suite using disposable unencrypted images (aborts if owner paths exist) | `server/dataset-guard.mjs`, `test/security.test.mjs`, `test/storage-volume.test.mjs` |
| C | JPEG-only by default (`--allow-heic` opt-in). HEIC fails closed without explicit orientation. Output must carry no orientation tag. Tool temp files confined inside the dataset root. INT/TERM trap fixed. Swift/ImageIO fixture generator and orientation oracle. 8-orientation × HEIC/JPEG matrix | `scripts/strip_metadata.sh`, `test/fixtures/*.swift`, `test/heic-orientation.test.sh`, `test/metadata.test.sh` |
| D | `annotate.html` no longer has a file picker. Images load by code only from the guarded server, and the guard header is required. Evaluate heading corrected | `annotate.html`, `src/annotate.js`, `evaluate.html` |
| E | Installer validates the target (worktree top level containing the guard), wires the target's own hooks, refuses to clobber, and never writes global config. New uninstaller | `scripts/git-guard/install-worktree-hook.sh`, `scripts/git-guard/uninstall-worktree-hook.sh`, `test/git-hook-installer.test.sh` |
| F | Consolidated matrix A-01 to A-14, P-1 to P-8, ST-OWNER-1 to 3; ticket/register label mismatches reconciled | `AURA_PALM_01_G4_B2B_OWNER_DECISION_MATRIX.md` |

Unchanged: `src/metrics.js`, `src/creases.js`, `src/pipeline.js`, `scoreImage`, the frozen criteria document, `apps/`, `packages/`.

## 3. Evidence
| Suite (run from `research/palm-scan-g4a`) | Kind | Result |
|---|---|---|
| `node test/security.test.mjs` | simulated + filesystem | **68 passed, 0 failed** |
| `node test/storage-volume.test.mjs` | **real** disposable unencrypted images | **24 passed, 0 failed** |
| `sh test/metadata.test.sh` | synthetic images | **24 passed, 0 failed** |
| `sh test/heic-orientation.test.sh` | synthetic images, 8 orientations × 2 formats | **39 passed, 0 failed** |
| `sh test/git-guard.test.sh` | throwaway repo | **10 passed, 0 failed** |
| `sh test/git-hook-installer.test.sh` | throwaway repo + 2 worktrees | **31 passed, 0 failed** |
| `node test/metrics.test.mjs` | frozen-rule regression | **9 passed, 0 failed** |
| **Total automated** | | **205 passed, 0 failed** |
| Browser end-to-end (built-in Chromium, synthetic) | manual, AI-driven | **10/10 requirement rows PASS** (Browser Privacy Test Results) |
| Real encrypted-volume acceptance | owner | **BLOCKED — AWAITING_OWNER_STORAGE** |

All JS modules pass `node --check`; all shell scripts pass `sh -n`.

## 4. Result categories
- **Verified (real system):**
  - Every guard failure case against real `hdiutil`/`df`, including an unencrypted image really mounted at `/Volumes/PALM_G4B_DATA`.
  - Detach handling.
  - Installer scope.
  - Browser storage-root refusal, locality and persistence.
- **Verified (synthetic data):**
  - Orientation and metadata removal for all 8 orientations, HEIC and JPEG.
  - Annotation and evaluation flows.
- **Simulated only:**
  - Acceptance of an approved encrypted image.
  - Duplicate-mount and consent-image refusal.
  - Missing or non-boolean encryption flag.
- **Unverified:**
  - Real phone HEIC files.
  - Non-Apple HEIC encoders.
  - Temp writes outside `TMPDIR` (would need `fs_usage`).
  - The browser's internal disk cache.
- **Owner-dependent:**
  - ST-OWNER-1/2/3.
  - A-01 to A-14.
  - Collection authorization.

## 5. Housekeeping
- Temporary preview configs were added to the main checkout's `.claude/launch.json` and then restored. `git diff` is clean.
- All disposable images, temp repositories, the synthetic browser root and the fixtures were deleted.
- `hdiutil info` lists only two pre-existing iOS Simulator images.
