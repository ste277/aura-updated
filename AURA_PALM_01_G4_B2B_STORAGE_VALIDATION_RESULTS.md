# AURA-PALM-01-G4-B2B — Storage Validation Results (Task B)

**Code under test:** `research/palm-scan-g4a/server/dataset-guard.mjs` and `scripts/check-dataset-root.mjs` (research worktree `palm-g4a-scan`, untracked, uncommitted).
**Data:** synthetic only. Real tests used **disposable, empty, UNENCRYPTED** disk images created under the OS temp directory. Each was detached and deleted in the same run. No encrypted image was created. `~/AuraResearch` was not created.

Legend: **VERIFIED (real)** = exercised against real macOS `hdiutil` / `df` / filesystem. **SIMULATED** = logic exercised with an injected probe. **PENDING (owner)** = can only be shown by the owner.

## 1. Change made
| Gap | Fix |
|---|---|
| Requirement 6 ("rejects unexpected mount points"): the guard required `/Volumes/…` and the approved image *file*, but accepted that image mounted at **any** `/Volumes/` path, for example a duplicate `/Volumes/PALM_G4B_DATA 1`. | Added `DEFAULTS.approvedMountPoint = '/Volumes/PALM_G4B_DATA'`. After all encryption, ownership and image checks pass, the root's mount point must equal it exactly; otherwise the guard returns `UNEXPECTED_MOUNT_POINT`. This adds a check and weakens none. |
| The B2A "real unencrypted image" test passed only while a volume left mounted by a previous session existed (its path was hard-coded to that session's scratchpad). Run today, it **failed** (61/62). | Replaced it with a self-contained suite, `test/storage-volume.test.mjs`, that creates, attaches, tests, detaches and deletes its own disposable images. It aborts if `/Volumes/PALM_G4B_DATA`, `/Volumes/PALM_G4B_CONSENT` or `~/AuraResearch` already exists, so it can never interfere with owner storage. |

## 2. Requirement-by-requirement
| # | Requirement | Result | Evidence |
|---|---|---|---|
| 1 | Resolves the actual filesystem and mount point | **VERIFIED (real)** | Root is canonicalised with `realpath`. `df -P` gives the device and mount point, matched to `hdiutil info -plist` `system-entities` by **both** `dev-entry` and `mount-point`. A real attach was listed with its mount point; `owner-uid` equalled the current user. |
| 2 | Rejects unencrypted disk images | **VERIFIED (real)** | Real APFS sparse image without `-encryption`: `hdiutil isencrypted` reported `NO`, `hdiutil info` reported `image-encrypted: false`, and the guard returned `VOLUME_NOT_ENCRYPTED`. This held even when that image was passed as the "approved" file at the "approved" mount point. Also refused by the CLI (exit 1), `strip_metadata.sh` (`REJECTED VOLUME_NOT_ENCRYPTED`) and the server (startup `REJECTED`, `/eval` → 503). |
| 3 | Rejects ordinary folders with approved-looking names | **VERIFIED (real)** | A temp folder → `NOT_ON_MOUNTED_VOLUME`. A symlink named `PALM_G4B_DATA` → `VOLUME_NOT_ENCRYPTED` (resolved first). A disposable **unencrypted image named `PALM_G4B_DATA`, really mounted at `/Volumes/PALM_G4B_DATA`** → `VOLUME_NOT_ENCRYPTED`; the owner command did **not** print `OK`. SIMULATED: a non-image volume with that name → `VOLUME_NOT_A_DISK_IMAGE`. |
| 4 | Rejects symlinks escaping approved boundaries | **VERIFIED (real)** | A symlink inside a mounted volume pointing into the repository → `DATASET_ROOT_IN_REPOSITORY`; one pointing to `~/Desktop` → refused. Per-file `resolveInside` escape, traversal and absolute-path cases are covered in `security.test.mjs`. |
| 5 | Rejects repository and worktree paths | **VERIFIED (real)** | Repository root, a symlink into the repo, and `..` traversal → `DATASET_ROOT_IN_REPOSITORY` (all ~120 worktrees are enumerated). Enumeration failure → `REPO_ENUMERATION_FAILED`. |
| 6 | Rejects unexpected mount points | **VERIFIED (real)** + **SIMULATED** | Real attach at a custom mount point outside `/Volumes` → `NOT_ON_MOUNTED_VOLUME`. SIMULATED (new): the approved encrypted image at `/Volumes/PALM_G4B_DATA 1` or `/Volumes/OTHER` → `UNEXPECTED_MOUNT_POINT`; the encrypted **CONSENT** image offered as the data root → `VOLUME_NOT_APPROVED_IMAGE`. |
| 7 | Rejects unavailable or detached volumes | **VERIFIED (real)** | After a real detach, the path → `DATASET_ROOT_MISSING`. A symlink to the detached volume → `DATASET_ROOT_MISSING`. CLI exit 1. |
| 8 | Fails closed when encryption status cannot be established | **SIMULATED** | `image-encrypted` key absent → `VOLUME_NOT_ENCRYPTED`. Value `"true"` (string, not boolean) → refused. Device mismatch → `VOLUME_NOT_A_DISK_IMAGE`. `df` throws, or `hdiutil` throws → `STORAGE_VERIFICATION_FAILED`. |
| — | Positive: approved encrypted image accepted | **SIMULATED only** | Injected probe → accepted. **Not a physical PASS.** |
| — | **Positive: real owner volume → `OK VERIFIED-ENCRYPTED`** | **PENDING (owner) — BLOCKED: AWAITING_OWNER_STORAGE** | ST-OWNER-1, Setup Guide §6. |

## 3. Test totals
| Suite | Result |
|---|---|
| `node test/security.test.mjs` (simulated + filesystem; 7 new B2B cases) | **68 passed, 0 failed** (B2A: 62, of which 1 depended on a leftover mounted image) |
| `node test/storage-volume.test.mjs` (new, real disposable unencrypted images) | **24 passed, 0 failed** |

The cleanup assertions inside the real suite all passed: no disposable image attached afterwards; `/Volumes/AURA_G4B2B_UNENC` and `/Volumes/PALM_G4B_DATA` absent; the image files deleted; `~/AuraResearch` absent. Afterwards `hdiutil info` listed only two pre-existing iOS Simulator runtime images, which are unrelated to this work.

## 4. Owner verification command (prepared, not run)
```bash
node scripts/check-dataset-root.mjs /Volumes/PALM_G4B_DATA
```
Expected: `OK VERIFIED-ENCRYPTED`. Run from `research/palm-scan-g4a` after Setup Guide §1–5.

## 5. Limitations (unchanged from B2A, restated)
- The guard trusts macOS `hdiutil`'s `image-encrypted` flag. It does not check the cipher or passphrase strength.
- While the volume is attached, any process running as the same macOS user can read it. The guard governs this harness only.
- Time-of-check vs time-of-use: the root is re-validated on every server request, which narrows but does not close the window.
- If the owner keeps the image anywhere other than `~/AuraResearch/palm-g4b/PALM_G4B_DATA.sparseimage`, or mounts it elsewhere, `DEFAULTS` must be changed under a ticket. Until then the guard refuses it, by design.
