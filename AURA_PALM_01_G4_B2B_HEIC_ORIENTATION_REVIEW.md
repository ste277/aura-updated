# AURA-PALM-01-G4-B2B — HEIC Orientation Review (Task C)

**Data:** synthetic only. Fixtures are 320×200 gradients with a RED block at the stored top-left, a GREEN block at the stored top-right, and fake metadata (`SYNTH-MAKE`, `SYNTH-MODEL`, `SYNTH-LENS`, `SYNTH-SENTINEL`, GPS 51.5 N / 0.12 W). They were generated with macOS ImageIO (`test/fixtures/gen_synthetic.swift`, compiled with the already-installed `swiftc`). **No software was installed or repaired.**

## 1. Decision
| Item | Result |
|---|---|
| HEIC orientation (Apple-encoded, all 8 EXIF orientations) | **VERIFIED on synthetic data** |
| JPEG orientation (all 8) | **VERIFIED on synthetic data**, with two independent decoders agreeing |
| **Recommendation for the first G4-B dataset** | **JPEG-only intake.** This is now the default in code: HEIC is refused unless `--allow-heic` is passed. HEIC is retained as an owner-approvable fallback (proposed A-05 addendum). |

**Why JPEG-only despite HEIC passing:**
- **The HEIC evidence is not independent.** ImageMagick's HEIC module and `libheif` are both broken on this Mac (missing `x265` library), so the conversion (`sips`) and the reference rendering (the oracle) both use Apple ImageIO. For JPEG, ImageMagick's `-auto-orient` and ImageIO's rendering are separate engines, and they agreed.
- **Encoder coverage is narrow.** ImageIO always writes a matching `irot`/`imir` box and EXIF orientation. A HEIC that carries one without the other, or a conflicting pair, could not be constructed with built-in tools, and non-Apple (e.g. Android) HEIC encoders were not tested.
- **The cost is low.** iPhone *Settings › Camera › Formats › Most Compatible* captures JPEG directly.

## 2. Finding that corrects B2A
B2A recorded: "sips drops HEIC orientation metadata before auto-orient." **That assumption is false on this Mac.**

`sips -s format jpeg` keeps the stored pixels unchanged and writes the correct EXIF orientation into the intermediate JPEG for every orientation:
- 1→TopLeft, 2→TopRight, 3→BottomRight, 4→BottomLeft
- 5→LeftTop, 6→RightTop, 7→RightBottom, 8→LeftBottom

`magick -auto-orient` then rotates the pixels upright, and `-strip` removes the tag. The B2A fixture path (JPEG → `sips` → HEIC) also preserved orientation.

## 3. Requirement results (`sh test/heic-orientation.test.sh` — 39 passed, 0 failed)
| Requirement | HEIC | JPEG | Evidence |
|---|---|---|---|
| Preserves visible orientation | PASS ×8 | PASS ×8 | Output rendering equals the ImageIO display rendering of the source. The oracle's own expectations were checked against the EXIF specification for all 8 orientations (e.g. orientation 6 → 200×320, red top-right, green bottom-right). |
| Pixel ↔ annotation-coordinate relationship | PASS ×8 | PASS ×8 | Output has **no** orientation tag (`Undefined`) and stored dimensions equal displayed dimensions, so stored pixels are what is displayed. Browser check (Task D): the annotation canvas loaded an orientation-6 output as 200×320, upright, and saved traces were in bounds of 200×320. |
| Removes GPS and device metadata | PASS ×8 | PASS ×8 | Zero EXIF fields. No `SYNTH-`, `GPS`, `Exif` or `xmpmeta` bytes. |
| Cleans intermediate files | PASS | n/a | No `.tmp_*` or `.work_*` left after success or failure. |
| Stays inside the dataset boundary | PASS (see §5) | PASS | `TMPDIR` and `MAGICK_TEMPORARY_PATH` now point to a mode-700 work directory inside `<root>/images/_intake/`. The caller's temp dir held nothing new afterwards. |
| Fails closed if orientation cannot be established | PASS | n/a | A shimmed converter that drops orientation → `FAIL … HEIC_ORIENTATION_UNVERIFIED`, with no output and no intermediate left. |
| HEIC not silently accepted | PASS | n/a | Without `--allow-heic`: `REJECTED HEIC_NOT_ENABLED (JPEG-only intake)`. `.heif` is also gated. |

## 4. Code changes (`scripts/strip_metadata.sh`)
1. **JPEG-only by default.** HEIC/HEIF requires `--allow-heic`.
2. **HEIC fail-closed check.** After `sips`, the intermediate must report an explicit orientation (one of the 8 values). Otherwise the result is `HEIC_ORIENTATION_UNVERIFIED`.
3. **Output post-condition.** Any orientation tag remaining in the output means `ORIENTATION_TAG_REMAINS` and the output is removed.
4. **Temp confinement.** Tool temp files go to `<root>/images/_intake/.work_<CODE>` (mode 700), which is removed on exit. INT/TERM now cleans up and exits; previously the trap could fall through.
5. **Test fixtures.** `test/metadata.test.sh` now uses the Swift generator. The B2A Pillow generator lived in a past session's scratchpad and Pillow is not installed, so the B2A suite was **not re-runnable as shipped**. Result: 24 passed, 0 failed (it now includes the "HEIC refused by default" case).

## 5. Limitations
- **Not observable without root.** Temp confinement was checked by watching `TMPDIR`. ImageIO could still write to the per-user `DARWIN_USER_TEMP_DIR`/cache directories, which do not follow `TMPDIR`. A full check needs `fs_usage` (root), which was not used.
- **Same engine for HEIC.** HEIC conversion and the HEIC oracle share Apple ImageIO (§1).
- **Real camera files not tested.** Real iPhone HEIC files (HEVC tiles, depth/gain maps, Live Photo pairs) were not tested; only ImageIO-encoded synthetic HEIC. JPEG-only intake avoids this.
- **Visual check required.** Mandatory human step at intake (procedure, not code): the annotator confirms the cleaned image is upright, fingers pointing up, before tracing.
