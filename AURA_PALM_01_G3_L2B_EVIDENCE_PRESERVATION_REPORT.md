# AURA-PALM-01-G3-L2B-E: AI Generation Evidence Preservation Report

**Date:** 2026-11-11 · **Authorization:** G3-L2B-E (local evidence preservation only)
**Result: COMPLETE AND VERIFIED.** An encrypted, owner-only local backup of all 174 evidence files was made. Originals are unchanged; the active session was not interrupted. Nothing was uploaded, synchronized, transmitted or shared. No transcript content is reproduced here.

## 1. Count reconciliation (done before copying)

| Component | Files |
|---|---|
| Main session transcript (`b1121d49-….jsonl`) | 1 |
| `b1121d49-…/subagents/` | **132** = **44 sub-agent transcripts (`.jsonl`) + 88 metadata (`.json`)** |
| `b1121d49-…/tool-results/` | 40 |
| `b1121d49-…/custom-title.json` | 1 |
| **Total (= evidence manifest)** | **174** |

The earlier figure "132" was the `subagents/` folder alone. The file count was unchanged between the snapshot (13:31:49Z) and the copy.

## 2. Backup location and protection

| Item | Value |
|---|---|
| Backup file | `/Users/stephen/AuraEvidence/AURA_PALM_01_G3_L2B_AI_EVIDENCE_20261111.sparseimage` |
| Folder | `/Users/stephen/AuraEvidence/` (mode `drwx------`, owner-only). Outside the repository, outside the active session directory, and not in Desktop/Documents (which may be iCloud-synced) |
| File mode | `-rw-------` (owner-only) |
| Encryption | macOS `hdiutil` encrypted disk image, **AES-256**, sparse image, APFS volume "AURA_EVIDENCE". `hdiutil isencrypted`: `encrypted: YES`, `passphrase-count: 1`, `private-key-count: 0` |
| Passphrase | Set and entered **by the owner** in their own terminal. It never passed through the assistant and is not recorded anywhere in the repository or reports. **If it is lost, the backup cannot be recovered** |
| Plaintext check | Raw image scanned for transcript markers: **0 hits** |
| Container SHA-256 (locked image, at detach) | `038dc1784148d7b3a47b3f6b68c2586c62a574055eee7eb40023cc3d2521458b` (changes whenever the image is mounted read-write) |
| State | **Detached (locked)** |
| Unencrypted copies | **None created** (files were copied directly into the mounted encrypted volume; the scratch area held only hash lists, never transcript content) |

## 3. Contents of the encrypted volume

```
AURA_EVIDENCE/                          (mode drwx------)
├── evidence/
│   ├── b1121d49-418e-41ef-a69a-ffd7ecb8d667.jsonl
│   └── b1121d49-418e-41ef-a69a-ffd7ecb8d667/
│       ├── custom-title.json
│       ├── subagents/        (132 files)
│       └── tool-results/     (40 files)
└── manifests/
    ├── source_snapshot_20261111T133149Z.tsv   (path, size, mtime, birthtime, SHA-256 at snapshot)
    ├── pre_copy.tsv / post_copy.tsv           (source SHA-256 immediately before and after copying)
    ├── backup.tsv                             (backup SHA-256 per file)
    └── SHA256SUMS                             (shasum -c format, relative to evidence/)
```

Original file names and directory structure are preserved. The copy was made with `ditto` (macOS), at 2026-11-11T13:42:32Z–13:42:33Z.

## 4. Verification results

| Check | Result |
|---|---|
| Files in backup vs snapshot manifest | **174 / 174**; none missing, none extra |
| Backup SHA-256 = snapshot SHA-256 | **173 / 174** |
| File that differs from the snapshot | **`b1121d49-…jsonl` (main transcript)**. It changed **after** the 13:31:49Z snapshot because the session is live. Snapshot: 32,232,915 bytes, SHA-256 `bbe98c21df27eec7e4c1b054aff8836d9a82d95d893bd80c0ef67e494184bdd3`. Backup (source state at copy time): 32,492,493 bytes, SHA-256 `f4660ebca6ed8deb3520064874fa227c5c9bd07f29638f8096dd3c0590b352e3` |
| Backup = source at copy time (pre-copy hashes) | **174 / 174** |
| Source changed **during** copying | **None** (pre-copy = post-copy for all files) |
| `SHA256SUMS` self-check inside the volume | **0 failures** |
| Modification times preserved | **174 / 174** |
| Creation (birth) times preserved | **129 / 174**. For 45 files, `ditto` set the copy time as the creation time. **The original creation times for all 174 files are recorded in `manifests/source_snapshot_20261111T133149Z.tsv`** |
| Originals modified, moved or deleted | **No** (read only) |
| Active session interrupted | **No** |

**Point-in-time note.** The source session remains active, so the originals will keep changing. The backup preserves their exact state at 13:42:32Z (and the snapshot hashes from 13:31:49Z). A later refresh, for example when the session is closed, would need separate authorization.

## 5. Recovery instructions

1. Open: `hdiutil attach ~/AuraEvidence/AURA_PALM_01_G3_L2B_AI_EVIDENCE_20261111.sparseimage`, then enter the owner's passphrase. The volume mounts at `/Volumes/AURA_EVIDENCE`. For read-only inspection, add `-readonly`.
2. Verify: `cd /Volumes/AURA_EVIDENCE/evidence && shasum -a 256 -c ../manifests/SHA256SUMS` (expect every line `OK`).
3. Compare with the original snapshot: `manifests/source_snapshot_20261111T133149Z.tsv` (column 5 = SHA-256; columns 3–4 = original modified and created times).
4. Close: `hdiutil detach /Volumes/AURA_EVIDENCE`.
5. **Do not** copy the contents out unencrypted. Transcripts contain unrelated conversations and must not be shared wholesale; any extract needs redaction and owner approval.

**Single-copy risk.** This backup is on the same machine as the originals. A second encrypted copy on separate owner-controlled media would protect against device loss. **That needs separate authorization** (no cloud sync was used or recommended here).

## 6. Restrictions preserved

No reviewer assignment, external sharing, governance amendments or licence implementation. G3-L2B-R: awaiting reviewer and owner authorization · G3-L2B-G: HOLD · G3-L2-I: HOLD · Publication: HOLD · Merge freeze: ACTIVE · External legal review: DEFERRED, NOT WAIVED. Repository: no tracked-file changes; this report is an untracked local document.
