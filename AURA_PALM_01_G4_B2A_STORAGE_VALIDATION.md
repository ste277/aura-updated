# AURA-PALM-01-G4-B2A — Storage Validation

## 1. Rule
Research data may be read or written only under a dataset root that passes `validateDatasetRoot`. Every consumer runs the same check: server start, every `/eval/*` request, every POST, `build-manifest`, and `strip_metadata`. If it fails, the command refuses with an error code. There is **no in-repository fallback**.

## 2. Verification order (fail closed)
1. The root is given explicitly, absolute, exists, and is a directory. It is canonicalised with `realpath`, so symlinks and `..` are resolved before any check.
2. **Not in a repository.** It is not inside any path from `git worktree list --porcelain` (all 120 worktrees) and has no `.git` ancestor. If enumeration fails, the root is refused (`REPO_ENUMERATION_FAILED`).
3. **Not a synced or default user folder:** `~/.claude`, Desktop, Documents, Downloads, iCloud `Mobile Documents`, `Library/CloudStorage`.
4. **Mounted volume.** The `df -P` mount point must not be `/`.
5. **Encrypted disk image, checked by attributes, not name.** In `hdiutil info -plist`, the image whose `system-entities` include the same `dev-entry` and `mount-point` must report `image-encrypted: true` and an `owner-uid` equal to the current user, and its `image-path` must equal the approved image (`~/AuraResearch/palm-g4b/PALM_G4B_DATA.sparseimage`).
6. **Outputs.** Written only to `<root>/outputs` (`OUTPUT_DIR_NOT_APPROVED` otherwise).
7. **Per-file confinement.** `resolveInside` rejects absolute paths, `..`, NUL bytes, symlink escape and missing files.

**Synthetic-test mode** is only for these tests. It needs all three of: `--synthetic-test`, env `AURA_G4B_SYNTHETIC_TEST=1`, and the marker file `.aura-g4b-synthetic-test-root`. The root must be under the OS temp directory. Steps 1 to 3 still apply. Responses are tagged `X-Aura-Dataset-Guard: synthetic-test`, and reports say `[SYNTHETIC TEST DATA]`.

## 3. Results
| Case | Result |
|---|---|
| Missing, empty, relative or non-existent root | PASS (refused) |
| Repo path, symlink into repo, `..` traversal into repo, Desktop | PASS (refused) |
| Repo enumeration fails | PASS (refused) |
| Temp dir on the system disk (real system probe) | PASS (refused: `NOT_ON_MOUNTED_VOLUME`) |
| Volume named `PALM_G4B_DATA` that is not a disk image (simulated) | PASS (refused: name not trusted) |
| Unencrypted image, wrong owner, or unapproved image file (simulated) | PASS (refused) |
| **Real mounted unencrypted disk image** `AURA_G4B_UNENC_TEST` (real `hdiutil`) | PASS (refused: `VOLUME_NOT_ENCRYPTED`), through both the Node guard and `strip_metadata.sh` |
| Probe throws | PASS (refused: `STORAGE_VERIFICATION_FAILED`) |
| Approved encrypted image (**simulated probe**) | PASS (accepted). Logic only. |
| **Approved encrypted image, real owner volume** | **BLOCKED — AWAITING_OWNER_STORAGE** |
| Server `/eval` with no dataset, or with the repo as dataset | PASS (503 with code) |
| Output dir outside `<root>/outputs` or in the repo | PASS (refused) |

## 4. Limitations
- The check trusts macOS `hdiutil`'s `image-encrypted` flag. It does not verify the cipher or passphrase strength; the owner sets AES-256 when creating the image (G4-B1 runbook).
- While the volume is mounted, any process running as the same user can read it. The guard governs this harness, not the operating system.
- The check runs at access time (time-of-check vs time-of-use). Per-request re-validation narrows that window but does not remove it.
- If the owner keeps the image somewhere else, `DEFAULTS.approvedImage` must be updated. Until then, the guard refuses the image.

## 5. Owner verification step (when A-series approvals allow)
After creating and mounting the approved encrypted image, the owner runs:
`node scripts/check-dataset-root.mjs /Volumes/PALM_G4B_DATA`
The expected output is `OK VERIFIED-ENCRYPTED`. Record the result in the Security Test Results document, row ST-OWNER-1. Do not place any participant photo on the volume until real-image collection is authorised separately.
