# AURA-PALM-01-G4-B2B — Encrypted Storage Setup Guide (owner-executed)

**Status:** PREPARED. **Not executed.** No volume, image or folder described here has been created. `~/AuraResearch` does not exist (checked 2026-11-11).
**Who runs this:** the owner only, in Terminal, typing the passphrases personally. No AI assistant runs these commands or sees the passphrases.
**When:** only after the owner approves A-03 (storage) and A-04 (backup / Time Machine). Creating storage does **not** authorise collection. Do not put any participant photograph on either volume until collection is separately authorised (Collection Authorization §7).

> **Passphrase rules.** Two different passphrases (A for DATA, B for CONSENT), generated and kept in your password manager. They are typed (or pasted) only into a hidden prompt. Never put them in a command line, script, file, report, chat or the macOS keychain. Every `hdiutil` command below uses `-stdinpass`. On a terminal, `-stdinpass` reads with `readpassphrase(3)`, so input is hidden, nothing appears in shell history, and no "remember in keychain" dialog appears.

---

## 0. Pre-checks (read-only)

```bash
fdesetup status
```
Expected: `FileVault is On.`

```bash
ls -ld ~/AuraResearch /Volumes/PALM_G4B_DATA /Volumes/PALM_G4B_CONSENT
```
Expected: three `No such file or directory` lines. If any exists, stop and investigate before continuing.

```bash
ls ~/Library/CloudStorage 2>/dev/null; echo "---"; ls ~/Library/Mobile\ Documents 2>/dev/null | head -3
```
Note any cloud providers. `~/AuraResearch` sits in the home root, which is outside iCloud Drive "Desktop & Documents" and outside `~/Library/CloudStorage`. Confirm that no Dropbox / Google Drive / OneDrive client is set to sync the whole home folder (A-11).

## 1. Create the folder

```bash
mkdir -m 700 ~/AuraResearch
```
```bash
mkdir -m 700 ~/AuraResearch/palm-g4b
```
```bash
ls -ld ~/AuraResearch ~/AuraResearch/palm-g4b
```
Expected: both `drwx------` and owned by you.

## 2. Create the DATA image (passphrase A)

```bash
hdiutil create -size 2g -fs APFS -volname PALM_G4B_DATA -encryption AES-256 -type SPARSE -stdinpass ~/AuraResearch/palm-g4b/PALM_G4B_DATA
```
At the hidden prompt, enter passphrase **A**. Some macOS versions ask only once, so step 4 confirms it immediately. If step 4 fails, the image is still empty: delete it (`rm ~/AuraResearch/palm-g4b/PALM_G4B_DATA.sparseimage`) and repeat this step.

```bash
chmod 600 ~/AuraResearch/palm-g4b/PALM_G4B_DATA.sparseimage
```
```bash
hdiutil isencrypted ~/AuraResearch/palm-g4b/PALM_G4B_DATA.sparseimage
```
Expected: `encrypted: YES` (this does not need the passphrase). If it says `NO`, stop, delete the image and re-create it. **Do not use it.**

## 3. Create the CONSENT image (passphrase B — different from A)

Skip this step if A-03 chooses paper consent records.

```bash
hdiutil create -size 512m -fs APFS -volname PALM_G4B_CONSENT -encryption AES-256 -type SPARSE -stdinpass ~/AuraResearch/palm-g4b/PALM_G4B_CONSENT
```
```bash
chmod 600 ~/AuraResearch/palm-g4b/PALM_G4B_CONSENT.sparseimage
```
```bash
hdiutil isencrypted ~/AuraResearch/palm-g4b/PALM_G4B_CONSENT.sparseimage
```
Expected: `encrypted: YES`.

## 4. Attach DATA (manual, every session)

```bash
hdiutil attach -stdinpass -nobrowse -noautoopen -owners on ~/AuraResearch/palm-g4b/PALM_G4B_DATA.sparseimage
```
Enter passphrase **A** at the hidden prompt.
- `-nobrowse` keeps the volume out of Finder's sidebar, which reduces Quick Look and preview caching. In Image Capture or an Open/Save dialog, press **Cmd+Shift+G** and type `/Volumes/PALM_G4B_DATA/images/_intake`.
- `-noautoopen` stops a Finder window from opening.
- `-owners on` makes the permissions below take effect.

```bash
mount | grep PALM_G4B_DATA
```
Expected: one line ending in `on /Volumes/PALM_G4B_DATA (apfs, local, nodev, nosuid, …)`. The mount point must be **exactly** `/Volumes/PALM_G4B_DATA`. If you see `/Volumes/PALM_G4B_DATA 1`, a second copy is mounted: detach everything and start again. The guard refuses any other mount point (`UNEXPECTED_MOUNT_POINT`).

## 5. First-time volume setup (DATA)

```bash
chmod 700 /Volumes/PALM_G4B_DATA
```
```bash
mkdir -m 700 /Volumes/PALM_G4B_DATA/images /Volumes/PALM_G4B_DATA/images/_intake /Volumes/PALM_G4B_DATA/annotations /Volumes/PALM_G4B_DATA/manifests /Volumes/PALM_G4B_DATA/outputs
```
Turn off Spotlight indexing. This is a system setting and needs your administrator password:
```bash
sudo mdutil -i off /Volumes/PALM_G4B_DATA
```
```bash
mdutil -s /Volumes/PALM_G4B_DATA
```
Expected: `Indexing disabled.`

## 6. Owner verification — ST-OWNER-1 (the gate this ticket could not run)

```bash
cd ~/Desktop/Claude/auraschedule-math-core/.claude/worktrees/palm-g4a-scan/research/palm-scan-g4a
```
```bash
node scripts/check-dataset-root.mjs /Volumes/PALM_G4B_DATA
```
**Expected:** `OK VERIFIED-ENCRYPTED`

The script prints a code only (never a path or data). If it prints anything else, **do not use the volume.** Common codes:

| Code | Meaning / action |
|---|---|
| `VOLUME_NOT_ENCRYPTED` | Image created without `-encryption`. Detach, delete, re-create (step 2). |
| `VOLUME_NOT_APPROVED_IMAGE` | The mounted image is not `~/AuraResearch/palm-g4b/PALM_G4B_DATA.sparseimage` (moved, renamed, or the CONSENT image). |
| `UNEXPECTED_MOUNT_POINT` | Not mounted at exactly `/Volumes/PALM_G4B_DATA` (duplicate mount or custom `-mountpoint`). |
| `NOT_ON_MOUNTED_VOLUME` / `VOLUME_NOT_A_DISK_IMAGE` | The path is an ordinary folder or a non-image disk. |
| `DATASET_ROOT_MISSING` | Volume not attached. |
| `VOLUME_NOT_OWNED_BY_USER` | Attached by a different macOS user. |
| `DATASET_ROOT_IN_REPOSITORY` / `DATASET_ROOT_FORBIDDEN_LOCATION` | The path resolves into a repository, Desktop, Documents, Downloads or a cloud folder. |
| `STORAGE_VERIFICATION_FAILED` / `REPO_ENUMERATION_FAILED` | A probe failed; the guard failed closed. Retry, then investigate. |

Record the result as ST-OWNER-1 (date and printed code only).

## 7. ST-OWNER-2 and the P-4 dry run (synthetic image only)

This needs the separate collection authorisation path to be open (A-05 decided). It uses **a generated gradient, never a photograph**.

```bash
magick -size 640x480 gradient:navy-orange /Volumes/PALM_G4B_DATA/images/_intake/synthetic_dryrun.jpg
```
```bash
sh scripts/strip_metadata.sh --dataset /Volumes/PALM_G4B_DATA --code DRY-T-01 --input synthetic_dryrun.jpg
```
Expected: `CLEAN DRY-T-01 (640x480)`.

```bash
node server/serve.mjs --dataset /Volumes/PALM_G4B_DATA
```
Expected first line: `dataset: verified encrypted volume`. In a second Terminal tab:
```bash
curl -s -D - -o /dev/null http://127.0.0.1:8765/eval/images/DRY-T-01.jpg | grep -i x-aura-dataset-guard
```
Expected: `X-Aura-Dataset-Guard: verified-encrypted`. Stop the server with Ctrl+C, then remove the dry-run files:
```bash
rm /Volumes/PALM_G4B_DATA/images/_intake/synthetic_dryrun.jpg /Volumes/PALM_G4B_DATA/images/DRY-T-01.jpg
```
Record this as ST-OWNER-2.

## 8. CONSENT volume checks (passphrase B)

```bash
hdiutil attach -stdinpass -nobrowse -noautoopen -owners on ~/AuraResearch/palm-g4b/PALM_G4B_CONSENT.sparseimage
```
```bash
chmod 700 /Volumes/PALM_G4B_CONSENT && mkdir -m 700 /Volumes/PALM_G4B_CONSENT/consent
```
Create `keymap/` only if A-06 chooses to keep a code key:
```bash
mkdir -m 700 /Volumes/PALM_G4B_CONSENT/keymap
```
```bash
sudo mdutil -i off /Volumes/PALM_G4B_CONSENT
```
**Expected refusal:** the research harness must never accept the consent volume.
```bash
node scripts/check-dataset-root.mjs /Volumes/PALM_G4B_CONSENT
```
Expected: `VOLUME_NOT_APPROVED_IMAGE`. Then detach it; keep it detached unless you are handling consent records:
```bash
hdiutil detach /Volumes/PALM_G4B_CONSENT
```

## 9. Detach at the end of every session

```bash
hdiutil detach /Volumes/PALM_G4B_DATA
```
```bash
node scripts/check-dataset-root.mjs /Volumes/PALM_G4B_DATA
```
Expected after detaching: `DATASET_ROOT_MISSING`.

## 10. No automatic mounting, no stored passphrases

- Do **not** add either image to Login Items, and do not double-click it in Finder (that path can offer to save the passphrase).
- Open **Keychain Access** and search for `PALM_G4B`. There should be **no** entry. If one exists, delete it.
- Do not create shell aliases, scripts or Shortcuts that contain a passphrase.

## 11. Backup and Time Machine (A-04 decision)

```bash
tmutil destinationinfo
```
If a destination exists and A-04 chooses exclusion:
```bash
tmutil addexclusion ~/AuraResearch
```
```bash
tmutil isexcluded ~/AuraResearch
```
Expected: `[Excluded]`.

## 12. Rollback (before any participant data exists)

```bash
hdiutil detach /Volumes/PALM_G4B_DATA; hdiutil detach /Volumes/PALM_G4B_CONSENT
```
```bash
rm ~/AuraResearch/palm-g4b/PALM_G4B_DATA.sparseimage ~/AuraResearch/palm-g4b/PALM_G4B_CONSENT.sparseimage
```
After participant data exists, use the deletion procedure in the G4-B1 Storage Plan §6, not this rollback.

## What this guide does not cover
- Encryption strength beyond what `hdiutil` reports. The guard trusts `image-encrypted` from `hdiutil info`. AES-256 is set by step 2, but the guard does not independently verify the cipher.
- Access by other processes running as the same user while the volume is attached (see the Storage Validation Results document §5).
- Legal adequacy of this storage arrangement (A-02, LEGAL_REVIEW_REQUIRED).
