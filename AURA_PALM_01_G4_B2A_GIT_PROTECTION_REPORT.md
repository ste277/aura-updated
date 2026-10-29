# AURA-PALM-01-G4-B2A — Git Protection Report

## 1. Layers
1. **`.gitignore`** (research dir): `eval/`, `images/`, `annotations/`, `manifests/`, `outputs/`, `consent*/`, `keymap/`, `*.annotation.json`, `SPLIT_LOCK.json`, `*.sparseimage`, `*.sparsebundle`, `*.dmg`, `*.heic`, `testdata/`, `models/*.task`, `vendor/`, `node_modules/`.
2. **Pre-commit guard** (`scripts/git-guard/pre-commit.mjs`). It inspects the **index**, not the working tree:
   - `git diff --cached --name-status -M -z` finds renames and copies, judged by their destination path. Force-added ignored files are still staged, so they are still inspected.
   - Path rules cover dataset dirs, annotation files, split locks, `AuraResearch/`, disk images, and consent or keymap dirs. Image extensions are blocked outside an explicit allow-list of product asset paths.
   - **Content sniffing:** each staged blob (`git show :path`) is checked for magic bytes (JPEG, PNG, HEIC/HEIF/AVIF ftyp, TIFF/RAW, WEBP, or an embedded `Exif\0\0` block). An image renamed to `.txt` is still caught.
   - **Consent-like text:** "participant code" plus "signature" or "consent record". `AURA_PALM_01_*.md` templates are exempt.
   - **Fails closed** if git cannot list or read staged content.
3. **Per-worktree installer** (`install-worktree-hook.sh`), for the owner to run. It sets `extensions.worktreeConfig` and `--worktree core.hooksPath`. It does **not** change global config, other worktrees, or other repositories. **It was not run under this ticket**; `core.hooksPath` is currently unset.

## 2. Test results (throwaway temp repo, synthetic fixtures): 10 passed, 0 failed
Blocked: synthetic JPEG in a research path, JPEG renamed `.txt` (magic bytes), HEIC magic bytes in a `.bin` file, force-added ignored `eval/manifest.json`, rename of a tracked file into `eval/`, an annotation JSON, consent-like record text, a `.sparseimage` file. Allowed: an ordinary source change, an image under an allow-listed app asset path. Each blocked case asserts both that content was staged and that the output says `commit BLOCKED`, so a block cannot be scored from an empty commit.

## 3. Wider repository
The guard is scoped to research data. The product repository's existing allow-listed asset paths (`apps/web/public/`, app icons, `docs/palmistry/screenshots/`) still commit normally.

## 4. Limitations: hooks do **not** guarantee prevention
- `git commit --no-verify` bypasses the hook (shown in the test run).
- Clones or worktrees without the hook, editors that commit through libgit2, plumbing (`git commit-tree`, `update-index`), and `core.hooksPath` overrides all bypass it.
- Magic-byte sniffing misses encrypted or archived images (zip, password-protected files) and images embedded in PDFs or other documents.
- Consent detection is a heuristic.

**Recommended additional controls (owner or governance decision; not implemented):** a CI job running the same guard script on PR diffs, and a branch-protection required check. The primary control remains that participant data lives only on the encrypted volume, outside every repository path, and that the harness refuses any other location.
