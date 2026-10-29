# AURA-PALM-01-G4-B2: Metadata Tool Evaluation

**Test data: synthetic only.** A generated gradient image (640×480) carrying fake metadata sentinels: Make "SyntheticMake", Model "SyntheticModelX", Software, timestamps, body serial "SYNTH-SN-0042", lens serial, user comment, a **GPS** block (lat/lon/altitude), an **XMP** packet, and **Orientation = 6** (rotate 90°). A HEIC copy was made with `sips`. No real person, photo or participant data was used. Nothing was installed.

## 1. Locally available tools (no installation)

| Tool | Version / location | Note |
|---|---|---|
| `sips` | macOS 14.6 built-in | Format conversion (incl. HEIC → JPEG) |
| ImageMagick `magick` | 7.1.2-17 (Homebrew, already installed) | **No HEIC decoder module** installed |
| `ffmpeg` | Homebrew, already installed | — |
| Pillow | 13.0.0, in a **temporary** session venv only | Not a durable install |
| `exiftool` | **Not installed** | Installing it needs owner authorization |

## 2. Results (measured)

| Method | EXIF | GPS | XMP / APP13 | Sentinels | Orientation applied | Verdict |
|---|---|---|---|---|---|---|
| Original (synthetic input) | 16 fields | 6 | XMP present | all 8 | n/a (tag = 6) | — |
| `sips -s format jpeg` re-save | **19 fields** | **5** | **APP13 Photoshop + XMP added** | **7** | No | **FAIL:** keeps (and adds) metadata |
| `magick … -auto-orient -strip` | 0 | 0 | none | none | **Yes** (480×640) | **PASS** |
| `ffmpeg -map_metadata -1` | 0 | 0 | none | none | Yes | PASS with caveat: writes a JPEG comment `Lavc62.28.102` (encoder tag) |
| Pillow re-encode (`exif_transpose` + fresh image + save) | 0 | 0 | none | none | Yes | **PASS** (needs a durable Pillow install) |
| HEIC via `magick` directly | — | — | — | — | — | **FAIL:** no HEIC delegate |
| HEIC → `sips` JPEG → `magick -auto-orient -strip` | 0 | 0 | none | none | Yes | **PASS.** The intermediate JPEG **still contains GPS/serials** (verified), so it must be created inside the encrypted volume and deleted |
| HEIC → `sips` JPEG → Pillow | 0 | 0 | none | none | Yes | PASS (same intermediate caveat) |

Pixel spot-checks confirmed that orientation was applied correctly; corner colours match a 90° clockwise rotation.

## 3. Recommendation (engineering)

- **Use ImageMagick (already installed):** `magick <in> -auto-orient -strip -quality 92 <out>.jpg`.
- **HEIC:** convert with `sips -s format jpeg` **inside the encrypted DATA volume** first, then strip, then delete the intermediate.
- Packaged as `research/palm-scan-g4a/scripts/strip_metadata.sh`. It **refuses to run unless the intake folder is under `/Volumes/PALM_G4B_DATA`** (verified: exit 2 elsewhere), won't overwrite existing outputs, and prints only file names and dimensions.
- **Do not use `sips` alone** for stripping.
- **Optional:** install `exiftool` as an independent second verifier (owner authorization required).

## 4. Verification procedure

`research/palm-scan-g4a/scripts/verify_clean.sh <file>` fails if ImageMagick reports **any EXIF field**, or the raw bytes contain any of: `Exif`, `<x:xmpmeta`, `http://ns.adobe.com/xap`, `Photoshop 3.0`, `ICC_PROFILE`, `GPS`.

Measured on the synthetic set:
- **flags** the original and the `sips` output;
- **passes** the ImageMagick, ffmpeg, Pillow and HEIC-path outputs.

Note: ImageMagick's own `%[xmp:*]` query reported 0 even on the input that contains XMP, which is why the byte-level check is required. The check doesn't flag JPEG comment (COM) segments, so `ffmpeg` output passes despite its encoder comment; prefer ImageMagick.

**Procedure per photo:**
1. Strip.
2. Verify (must print `CLEAN`).
3. Rename to the participant code.
4. Delete the intake original.
5. Spot-check 10% with a second method (e.g. `magick identify -verbose`, run locally; output not shared with any AI tool).

Synthetic test files remain only in the session scratchpad.
