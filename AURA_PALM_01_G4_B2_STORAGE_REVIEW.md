# AURA-PALM-01-G4-B2: Storage Design Review

**Reviewed:** `AURA_PALM_01_G4_B1_DATASET_STORAGE_PLAN.md`. **Nothing created or mounted** (`~/AuraResearch` doesn't exist; `/Volumes` shows only the system disk).

## 1. Local evidence (read-only checks, 2026-11-11)

| Check | Result |
|---|---|
| FileVault | **On** (`fdesetup status`) |
| iCloud Desktop & Documents sync | **Not enabled** (no `CloudDocs/Desktop` or `CloudDocs/Documents`) |
| Third-party cloud clients (`~/Library/CloudStorage`, Dropbox, Google Drive, OneDrive) | **None found** |
| Time Machine | **No destination configured** |
| macOS | 14.6 |
| `hdiutil` AES-256 sparse images | Available (already used successfully for the G3 evidence backup) |

## 2. Design validation

| Requirement | Design | Verdict |
|---|---|---|
| Separate encrypted images for photos and consent records | `PALM_G4B_DATA.sparseimage` and `PALM_G4B_CONSENT.sparseimage` (or paper consent) | **Meets** |
| Independent passphrases | A (data) ≠ B (consent), held by the owner in a password manager | **Meets** (owner process) |
| Owner-only access | Folder `700`, images `600`, volume roots `700`; FileVault on | **Meets** |
| No cloud sync | `~/AuraResearch` (home root) isn't synced; no cloud clients present | **Meets**. Re-check before collection if a sync client is installed later |
| Local-only processing | Strip/verify scripts local; research pages CSP + guard | **Meets** (desktop-verified) |
| Secure deletion | Delete files per withdrawal; at end delete the encrypted containers and discard passphrases (crypto-erase); log deletions | **Meets.** On SSD, overwriting is unreliable; crypto-erase is the correct approach |
| Recovery and backup | Default: none. Optional: one encrypted offline copy, logged | **Meets** (owner choice A-04). Note that a backup copy must also be deleted on withdrawal and at retention end |
| No participant images in the Git repository | Data lives only in the encrypted volumes. **Gap found:** the evaluation harness currently reads `eval/` relative to the research folder inside the repo worktree | **Action required before G4-B3** (below) |

## 3. Gaps and required changes (before collection; research code, needs authorization)

1. **Harness data path.** Change the evaluation server or harness to read the dataset directly from `/Volumes/PALM_G4B_DATA` (for example, a tiny local server mapping `/eval/` to the mounted volume, read-only). This avoids placing images, or links to them, inside the repository worktree. Until then, **don't** copy data into `research/palm-scan-g4a/eval/`.
2. **`build-manifest.mjs` path.** Accept an explicit dataset directory argument pointing to the volume (it currently uses `../eval/`).
3. **Spotlight:** after first mount, disable indexing on both volumes (owner runs `sudo mdutil -i off …`).
4. **Optional pre-commit hook** rejecting image and annotation files (A-10).

## 4. Verdict

**Design sound; ready to create once the owner authorizes**, subject to the two research-code path changes (items 1–2) before any real data is evaluated.
