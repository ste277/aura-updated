# AURA-PALM-01-G4-B2A — Implementation Report

**Ticket:** Palmistry Research Harness — Privacy Hardening and Encrypted Storage Compatibility
**Date:** 2026-11-11 · **Scope:** isolated research code + synthetic tests only
**Location:** `.claude/worktrees/palm-g4a-scan/research/palm-scan-g4a/` (branch `research/palm-g4a-scan-prototype`). All files are **untracked and uncommitted**. No commit, push, merge, or deploy took place.

> No participant photographs were collected, imported, opened, annotated, or processed. Every image used in testing was a synthetic gradient carrying fake sentinel metadata.

## 1. What changed, by task

| Task | Implemented safeguard | Files |
|---|---|---|
| A — External dataset root | The root must be given explicitly (`--dataset`). There is no in-repo fallback. The root is resolved with realpath, then refused if it sits inside any of the 120 worktrees or under a `.git` ancestor, or under Desktop, Documents, Downloads, iCloud, CloudStorage or `~/.claude`. Encryption is checked from `hdiutil info -plist` (the volume must be a disk image with `image-encrypted=true`, owned by the current uid, and backed by the approved image file), cross-checked with the `df` device and mount point. Volume names are never trusted. Unapproved output directories are refused. Any probe error fails closed. | `server/dataset-guard.mjs`, `scripts/check-dataset-root.mjs`, `server/serve.mjs`, `scripts/build-manifest.mjs` |
| B — Privacy-safe outputs | Report allow-list sanitiser. It refuses coordinates, landmarks, paths, data URLs, base64, GPS/EXIF keys or values, and unexpected URLs. The server checks every result again before writing it to `<root>/outputs`. The evaluator draws on off-screen canvases only and writes no thumbnails or downloads. Server logs record method, route class and status only. | `server/report-sanitizer.mjs`, `src/evaluate.js`, `server/serve.mjs` |
| C — Annotation schema v2 | Per crease (DTC, PTC, TC), visibility is `confident`, `uncertain` or `not_visible`. Each trace has a status. An image can be marked unsuitable, with a reason. Skin tone is self-reported only. v1 is accepted read-only as legacy. Malformed or inconsistent records are rejected. Scoring is unchanged. | `src/annotation-schema.js`, `annotate.html`, `src/annotate.js` |
| D — Git leak safeguards | `.gitignore` entries. A staged-content pre-commit guard that handles renames and force-adds, sniffs magic bytes (JPEG, PNG, HEIC/AVIF, TIFF, WEBP, EXIF) and detects consent-like text. A per-worktree installer that the owner runs (never installed globally, and not installed by this ticket). | `.gitignore`, `scripts/git-guard/*` |
| E — Metadata pipeline | `strip_metadata.sh` accepts only a validated dataset root. Input is read from `<root>/images/_intake/` only, and output goes to `<root>/images/<CODE>.jpg`. The script never overwrites, uses auto-orient + strip, converts HEIC through a sips intermediate that a trap deletes, removes the output on any failure, and sets mode 600. `verify_clean.sh` prints basenames only. | `scripts/strip_metadata.sh`, `scripts/verify_clean.sh` |
| F — AI isolation review | Static review against S-1 to S-8 (see the Security Test Results document, §5). A-12 remains AWAITING_OWNER. | — |
| G — Test matrix | `test/security.test.mjs` (62), `test/metadata.test.sh` (24), `test/git-guard.test.sh` (10), `test/metrics.test.mjs` (9, regression). | `test/*` |

## 2. Evidence summary
- **105 synthetic tests passed, 0 failed.** Details are in the Security Test Results document.
- One owner-dependent positive test is **BLOCKED — AWAITING_OWNER_STORAGE**: accepting the real approved encrypted volume. Its logic is covered only by a simulated probe.
- Frozen criteria are unchanged. `AURA_PALM_01_G4_B_ACCURACY_CRITERIA.md` SHA-256 is still `bcc8f204…ee43a9`. `scoreImage` and `metrics.js` were not modified.

## 3. What was NOT done (by design)
- No owner encrypted volume was created or mounted; `~/AuraResearch` does not exist.
- No real images. No annotation or evaluation was started.
- No production Aura code was touched (`apps/` and `packages/` are unchanged).
- No software was installed.
- No hook was installed in the real repository (`core.hooksPath` is unset).
- One synthetic, **unencrypted** test disk image (`AURA_G4B_UNENC_TEST`) was created in the session scratchpad as a negative fixture. It was detached and deleted after testing.

## 4. Limitations
See the Storage Validation document §4 and the Git Protection Report §4. The main ones:
- The hooks can be bypassed.
- The encryption check trusts the macOS `hdiutil` report.
- Same-user processes can read the mounted volume.
- sips drops HEIC orientation metadata before auto-orient, so HEIC rotation is untested (§E).
