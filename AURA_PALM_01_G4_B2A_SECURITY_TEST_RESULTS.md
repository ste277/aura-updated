# AURA-PALM-01-G4-B2A — Security Test Results

**Data used:** synthetic only. That means generated gradient images with fake sentinel EXIF, GPS and XMP (`SYNTH-*`), throwaway temp repositories and temp dataset roots, and one synthetic **unencrypted** disk image, used as a negative fixture and then deleted. **No real participant data was accessed.** `~/AuraResearch` does not exist, and no owner volume was created or mounted.

## 1. Totals
| Suite | Command (from `research/palm-scan-g4a`) | Result |
|---|---|---|
| Storage, paths, schema, sanitiser, server | `node test/security.test.mjs` | **62 passed, 0 failed** |
| Metadata pipeline | `PY=<python+Pillow> GEN=<make_synthetic.py> sh test/metadata.test.sh` | **24 passed, 0 failed** |
| Git guard | `sh test/git-guard.test.sh` | **10 passed, 0 failed** |
| Metrics regression (frozen rule) | `node test/metrics.test.mjs` | **9 passed, 0 failed** |
| Owner storage positive test | `node scripts/check-dataset-root.mjs /Volumes/PALM_G4B_DATA` | **BLOCKED — AWAITING_OWNER_STORAGE** |

All JS modules pass `node --check`.

## 2. Required matrix
| Required test | Result | Evidence |
|---|---|---|
| Missing dataset root | PASS | `DATASET_ROOT_REQUIRED`; server returns 503 `DATASET_NOT_CONFIGURED` |
| Repository dataset root | PASS | `DATASET_ROOT_IN_REPOSITORY` (guard, server, strip script) |
| Symlink into repository | PASS | Resolved by realpath, then refused |
| Path traversal | PASS | Root `..` into repo refused; `resolveInside` refuses `../`, absolute paths and NUL; encoded traversal on the server returns 403/404; strip script refuses `../` input names and path-like codes |
| Unverified encrypted storage | PASS | Real temp dir gives `NOT_ON_MOUNTED_VOLUME`; **real mounted unencrypted image** gives `VOLUME_NOT_ENCRYPTED`; a name-only volume gives `VOLUME_NOT_A_DISK_IMAGE`; wrong owner or unapproved image refused |
| Verified encrypted storage (real) | **BLOCKED — AWAITING_OWNER_STORAGE** | Simulated probe accepted (logic only) |
| Unauthorised output directory | PASS | `OUTPUT_DIR_NOT_APPROVED` (outside root, or repo) |
| Malformed annotation | PASS | 8 malformed or inconsistent cases rejected; server returns 422 |
| Uncertain annotation | PASS | Accepted; counted as `uncertainCreases` |
| Unusable image annotation | PASS | Accepted with reason; rejected without one |
| Legacy annotation | PASS | v1 read-only, visibility `unspecified`; save refused |
| Metadata stripping | PASS | JPEG with GPS and orientation 6 comes out clean (zero EXIF fields, no sentinel bytes), mode 600, script output has no paths |
| HEIC handling | PASS (partial) | HEIC is converted through sips and comes out clean. **Gap:** sips drops HEIC orientation metadata, so HEIC rotation is untested; see §4 |
| Orientation preservation | PASS (JPEG) | 640×480 with orientation 6 becomes 480×640 upright |
| Intermediate cleanup | PASS | No `.tmp_*` left after a HEIC success or after a HEIC conversion failure |
| Failed processing | PASS | Corrupt JPEG gives `STRIP_FAILED` and corrupt HEIC gives `CONVERSION_FAILED`, with no partial output; existing output is never overwritten |
| Output confinement | PASS | Symlinked intake file refused; output only `<root>/images/<CODE>.jpg` |
| Synthetic mode gating | PASS | Refused without the env flag, without the marker, or without `--synthetic-test` |
| Report privacy | PASS | Coordinates, landmarks, data URLs, paths, GPS and unexpected URLs rejected (sanitiser and server 422); clean report written only to `<root>/outputs` |
| Server logging | PASS | Logs contain no paths or participant codes |
| Git image commit | PASS | JPEG, renamed JPEG, HEIC magic all blocked |
| Git rename / force-add | PASS | Rename into `eval/` and force-added ignored file blocked |
| Git annotation / consent / disk image | PASS | Blocked |
| Git hook bypass | Documented | `--no-verify` bypasses the hook (expected limitation) |
| Regression | PASS | Metrics 9/9; frozen criteria SHA unchanged |

## 3. Owner-dependent rows
| ID | Test | Status |
|---|---|---|
| ST-OWNER-1 | `check-dataset-root.mjs` on the approved, mounted encrypted image returns `OK VERIFIED-ENCRYPTED` | BLOCKED — AWAITING_OWNER_STORAGE |
| ST-OWNER-2 | Server started with `--dataset` on the approved volume shows `dataset: verified encrypted volume` and `/eval` carries `X-Aura-Dataset-Guard: verified-encrypted` | BLOCKED — AWAITING_OWNER_STORAGE |
| ST-OWNER-3 | Per-worktree hook installed by the owner; a synthetic blocked commit is refused in the real worktree | AWAITING_OWNER (installer not run) |

## 4. Known gaps
- **HEIC orientation.** `sips` does not carry orientation into the intermediate. iPhone HEICs are usually stored with pixels already upright or with an `irot` box, which sips applies. This behaviour was **not verified** with a rotated synthetic HEIC; pillow-heif is not installed and no installs were authorised. Before real use, the owner (or a later ticket) should confirm it on a synthetic rotated HEIC.
- Only the server's endpoints were exercised. The browser pages (annotate and evaluate) were syntax-checked but not driven end to end against the synthetic root under this ticket. Their privacy properties rest on the server checks and the static review in §5.

## 5. AI isolation review (S-1 to S-8, static)
| Safeguard | Finding |
|---|---|
| S-1: AI never views participant images | The harness design keeps images on the encrypted volume, served only to the local browser. The annotation page carries a "human use only" notice. **Enforcement relies on procedure: A-12 is still AWAITING_OWNER.** |
| S-2: No cloud inference | MediaPipe runs locally from `models/`. CSP `connect-src 'self'`. No external URLs in `src`, `server` or the HTML. |
| S-3: Telemetry blocked | The privacy guard blocks `odml.pa.googleapis.com`; the sanitiser allows only that URL in `blockedRequests`. |
| S-4: No images or thumbnails in outputs | The evaluator uses off-screen canvases only (never attached to the DOM); there is no `toDataURL`, Blob, download or storage in the evaluate or annotate paths. `validate.js` renders thumbnails but is hard-wired to repo `testdata/` (synthetic G4-A images), which the server serves only from the static allow-list. |
| S-5: No coordinates or landmarks in reports | Enforced by the sanitiser on the client report and again on the server. |
| S-6: No paths, GPS or EXIF in outputs or logs | Sanitiser value checks; server logs record route class only; scripts print codes and basenames. |
| S-7: Data confined to the encrypted volume | Dataset guard on every access; annotations and results written only under the root, mode 600, no overwrite. |
| S-8: Agent tool outputs | Test and CLI output carry codes and counts only, so an agent running the scripts does not receive image content or coordinates. Running the harness on real data must still follow A-12 once it is decided. |
