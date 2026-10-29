# AURA-PALM-01-G4-B1: Dataset Storage Plan

**Status: PROPOSED. Nothing created.** No directories, disk images or photos have been created. Commands are for the owner to run after approval. **Supersedes** `AURA_PALM_01_G4_B_DATASET_REGISTER.md` §4 (storage in the repository's `research/palm-scan-g4a/eval/`), which is no longer acceptable because it lives inside the Git working tree.

## 1. Principles

1. Participant data lives **outside** the Git repository, Claude session folders, `~/Desktop`, `~/Documents` and any cloud-synced folder. (iCloud Drive is present on this Mac; Desktop & Documents sync status isn't confirmed. `~/AuraResearch` in the home root isn't a synced location by default.)
2. **Encrypted at rest**, with **owner-only** access.
3. **Identity and consent records are separated** from coded images: different container, different passphrase.
4. **Git ignore rules alone are not sufficient**, so the data never enters the repository tree at all.

## 2. Proposed structure

```
~/AuraResearch/                                   (drwx------)
└── palm-g4b/
    ├── PALM_G4B_DATA.sparseimage      AES-256 encrypted, passphrase A
    │     mounts at /Volumes/PALM_G4B_DATA
    │     ├── images/          coded photos (P07-L-01.jpg), EXIF-stripped
    │     ├── annotations/     *.annotation.json (coordinates only)
    │     ├── manifests/       manifest.json, SPLIT_LOCK.json, register.csv (codes only)
    │     └── outputs/         evaluation JSON (aggregates + per-image metrics, no images)
    ├── PALM_G4B_CONSENT.sparseimage   AES-256 encrypted, passphrase B (different)
    │     mounts at /Volumes/PALM_G4B_CONSENT
    │     ├── consent/         signed consent records (scans/PDFs)
    │     └── keymap/          participant-code ↔ contact (only if needed for withdrawal)
    └── DELETION_LOG.md       codes + dates only (no images, no identities)
```

- Paper consent forms are an alternative to the CONSENT image (stored physically and locked).
- **Raw intake** (photos straight from phones) goes directly into a temporary folder **inside the mounted DATA volume** (`images/_intake/`). It is EXIF-stripped and renamed there, and the originals are deleted. Nothing goes to Downloads, Photos libraries, AirDrop folders or the Desktop.

## 3. Creation (owner runs after approval; passphrases typed by the owner)

```bash
mkdir -m 700 -p ~/AuraResearch/palm-g4b
```

```bash
hdiutil create -size 2g -fs APFS -volname PALM_G4B_DATA -encryption AES-256 -type SPARSE ~/AuraResearch/palm-g4b/PALM_G4B_DATA
```

```bash
hdiutil create -size 512m -fs APFS -volname PALM_G4B_CONSENT -encryption AES-256 -type SPARSE ~/AuraResearch/palm-g4b/PALM_G4B_CONSENT
```

```bash
chmod 600 ~/AuraResearch/palm-g4b/*.sparseimage
```

After the first mount: `chmod 700` the volume roots; create the subfolders; disable Spotlight indexing of the volumes (`sudo mdutil -i off /Volumes/PALM_G4B_DATA`, which the owner runs; it's a system setting).

## 4. Controls against accidental commits and sync

| Risk | Control |
|---|---|
| Git commit | Data is **never** inside a repository path. The evaluation harness reads data via a **read-only, session-time link** (or a local server mapping) to `/Volumes/PALM_G4B_DATA`, created only while evaluating and removed afterwards. Optional extra: a local pre-commit hook that rejects image files and `*.annotation.json` (needs owner approval; `.git/hooks` is local) |
| Cloud sync | Location outside iCloud Drive, Desktop and Documents; verify no Dropbox/Google Drive/OneDrive client syncs `~/AuraResearch` |
| Photos app / AirDrop / Downloads leakage | Transfer from phones by **USB cable / Image Capture directly to `_intake/`**. Delete the photos from the phones after transfer and verification, including the "Recently Deleted" album |
| Spotlight / Quick Look caches | Indexing off on the volumes; don't preview images in Finder outside the mounted volume |
| Time Machine | The encrypted images may be backed up (still encrypted). The owner decides whether to exclude them (`tmutil addexclusion`) to keep deletion meaningful |
| **AI agents / development tools** | **No AI assistant (including Claude) may open, read, screenshot or display participant images or the evaluation app while it shows them.** Viewing an image through an AI tool transmits it to the model provider. Agents may only run local scripts and read **aggregate JSON** outputs (see the privacy risk register R-04) |

## 5. Backup and recovery

- **Default: no backup** of participant data beyond the encrypted volume itself. That minimises copies, and research data is re-collectable.
- If the owner wants resilience: one copy of the **encrypted** sparse image on owner-controlled offline media, recorded in the deletion log so it's included in deletion.
- **Passphrases** live in the owner's password manager. If they're lost, the data is unrecoverable (acceptable for research data).

## 6. Retention and deletion

| Event | Procedure |
|---|---|
| Withdrawal | Mount DATA → delete `images/` and `annotations/` files for the code → regenerate the manifest → log code + date in `DELETION_LOG.md` → confirm to the participant within the agreed period. Also delete from any backup copy |
| Retention end | Delete both sparse images (and any backup copies) with `rm`. On APFS/SSD, deleting the encrypted container and discarding its passphrase is the effective disposal (no reliable overwrite on SSDs). Log the date |
| Evaluation outputs | Per-image metrics contain codes and coordinates only. Delete with the dataset unless the owner approves keeping aggregates |

## 7. Owner decisions

Storage location confirmation; consent-records approach (encrypted image vs paper); backup (none vs encrypted offline copy); Time Machine exclusion; pre-commit hook; who holds passphrases.
