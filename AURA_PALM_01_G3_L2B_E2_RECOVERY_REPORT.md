# AURA-PALM-01-G3-L2B-E2: Secondary Encrypted Backup, Recovery Report

**Date:** 2026-11-11
**Status: BLOCKED — AWAITING_OWNER_STORAGE.** The primary backup is verified and unchanged. No secondary copy has been made, because no external, owner-controlled, physically separate storage is connected. Nothing was copied, mounted, unlocked, uploaded or shared.

## 1. Primary encrypted backup: verification (read-only; not unlocked)

| Check | Result |
|---|---|
| Location | `/Users/stephen/AuraEvidence/AURA_PALM_01_G3_L2B_AI_EVIDENCE_20261111.sparseimage` |
| Exists | Yes |
| Folder permissions | `drwx------` (owner-only) |
| File permissions | `-rw-------` (owner-only) |
| Size | 78,769,664 bytes |
| Modified | 2026-11-11T19:13:04+05:30 (at detach; unchanged since) |
| Attached? | **No** (not listed by `hdiutil info`; no `/Volumes/AURA_EVIDENCE`) |
| Encryption metadata | `hdiutil isencrypted`: `encrypted: YES`, `passphrase-count: 1`, `private-key-count: 0` (AES-256, per creation) |
| SHA-256 | `038dc1784148d7b3a47b3f6b68c2586c62a574055eee7eb40023cc3d2521458b`, **matching** `AURA_PALM_01_G3_L2B_EVIDENCE_PRESERVATION_REPORT.md` |
| Contents (from the preservation report; not re-opened) | 174 evidence files + manifests (snapshot, pre-copy, post-copy, backup, `SHA256SUMS`) |

**Correction to the ticket:** 13:42:32Z is the **copy time**. The source **snapshot** time was 13:31:49Z (preservation report §4).

## 2. Secondary storage: discovery

| Check | Result |
|---|---|
| External physical disks (`diskutil list external physical`) | **None** |
| Mounted volumes under `/Volumes` | Internal disk only ("Macintosh HD") |
| Network or shared mounts | None (none would be acceptable anyway) |
| Cloud-synced locations | Not considered (excluded by requirement) |

**No destination was selected automatically.**

## 3. Destination requirements (for the owner)

- An external drive (USB/Thunderbolt SSD or HDD) the owner controls, kept **physically separate** from the Mac after copying.
- **Not** cloud-synced, network-attached or shared.
- **At least 100 MB free** (the image is 78.8 MB).
- Any macOS-writable filesystem (APFS, HFS+ or exFAT). The image is already AES-256 encrypted, so drive-level encryption (FileVault-style encrypted APFS) is recommended defence in depth, not required.

## 4. Copy procedure (only after owner confirmation and authorization)

1. Owner connects the drive. I list it (`diskutil list external physical`, `df -h`) and the owner **confirms the exact volume**.
2. Check that the destination file doesn't already exist (no overwrite); copy with no-clobber: `cp -n` (the encrypted image file only; **no** decryption, repackaging or transcript copying).
3. SHA-256 of both files must equal `038dc178…458b`. Run `cmp` for a byte-for-byte check.
4. Run `hdiutil isencrypted` on the destination copy, which must report `encrypted: YES`.
5. Confirm no plaintext was written (nothing is mounted at any point; only the encrypted file is copied).
6. Eject the drive and store it separately.
7. Update this report with the destination, sizes and verification results.

## 5. Recovery instructions (either copy)

1. `hdiutil attach -readonly <path-to>/AURA_PALM_01_G3_L2B_AI_EVIDENCE_20261111.sparseimage`, then enter the owner's passphrase.
2. `cd /Volumes/AURA_EVIDENCE/evidence && shasum -a 256 -c ../manifests/SHA256SUMS` (all `OK`).
3. Compare with `manifests/source_snapshot_20261111T133149Z.tsv` if needed.
4. `hdiutil detach /Volumes/AURA_EVIDENCE`.

The passphrase is not recorded here or anywhere in the repository. **Without it neither copy can be recovered.**

## 6. Remaining risks

| Risk | Status |
|---|---|
| Single copy on the same device as the originals | **Open:** awaiting external storage |
| Passphrase loss | Owner-managed; store it in a password manager (it's the same passphrase for both copies) |
| Source session still changing | The backup is a point-in-time copy (13:42:32Z); a refresh needs separate authorization |
| Mounting read-write changes the image hash | Use `-readonly` for inspection |

## 7. Governance (unchanged)

| Gate | Status |
|---|---|
| G3-L2B-E | Complete |
| G3-L2B-E2 | **Blocked, awaiting owner storage** (preparation done) |
| G3-L2B-R | Awaiting reviewer authorization |
| G3-L2B-G | HOLD |
| G3-L2-I | HOLD |
| Publication | HOLD |
| Merge freeze | ACTIVE |

No source transcripts or manifests were modified. No governance amendments, code changes, commits, merges or deployments.
