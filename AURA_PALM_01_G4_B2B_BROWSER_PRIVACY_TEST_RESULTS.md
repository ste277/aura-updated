# AURA-PALM-01-G4-B2B — Browser Privacy Test Results (Task D)

**Method:** end-to-end in the Claude desktop app's built-in browser (Chromium), driven by the AI against the local guarded server (`server/serve.mjs`).
**Data:** synthetic only. Five gradient images (codes `S01`–`S05`, produced by the real `strip_metadata.sh`), four synthetic v2 annotations, and a manifest built by the real `build-manifest.mjs`. The synthetic root was under the session scratchpad (`/private/tmp/…`), marked with `.aura-g4b-synthetic-test-root`, and deleted after testing.

> **AI isolation.** The AI-controlled browser displayed and screenshotted **synthetic gradients only**, which the ticket permits. With participant photographs, this same procedure would breach S-1/S-2. Real-data browser use is **human-only** (A-12).

## 1. Code change
| Gap found | Fix |
|---|---|
| `annotate.html` loaded images through a browser **file picker**, so it could open a photo from **any** location (Downloads, Photos export, the repository, an intake original). Only *saving* was guarded. | The file picker was removed. Images now load by **code only**, from `GET eval/images/<CODE>.jpg` on the guarded server. The response must carry `X-Aura-Dataset-Guard: verified-encrypted` (or `synthetic-test`). Malformed codes are refused client-side. Synthetic responses show `[SYNTHETIC TEST DATA]`. |
| `evaluate.html` heading said "local data in eval/ only" (out of date) | Corrected; text only. |

## 2. Results
| Requirement | Result | Evidence |
|---|---|---|
| Interfaces reject unapproved storage roots | **PASS** | **No `--dataset`:** evaluate shows `Refused / error: DATASET_UNAVAILABLE_503`; annotate shows `Not loaded: DATASET_NOT_CONFIGURED`. **Repository as dataset:** server logs `dataset: REJECTED DATASET_ROOT_IN_REPOSITORY`; annotate load, `/eval/*` and an encoded traversal all return 503 `DATASET_ROOT_IN_REPOSITORY`. No file picker is present. |
| No real data or images needed | **PASS** | Entire flow ran on generated gradients. |
| Image processing remains local | **PASS** | MediaPipe wasm and the model were served from `vendor/` and `models/` by the local server. The evaluator draws only on off-screen canvases: 0 `<canvas>` and 0 `<img>` in the evaluate DOM. |
| No external network requests | **PASS** | Network log for the full evaluate and annotate session shows only `127.0.0.1:8773` / `localhost:8773`. `blockedRequests` was `[]`, so no telemetry was even attempted. CSP `connect-src 'self'` is unchanged. |
| No image data in console or AI-visible reports | **PASS** | The console held only MediaPipe/TFLite/WebGL engine logs: no data URLs, base64, pixels or paths. The saved report (`outputs/eval-*.json`, mode 600) matched 0 times for coordinate keys, `data:image`, base64, or `/Users/` / `/private/` / `/Volumes/`. |
| No detailed crease coordinates in reports | **PASS** | Report per-image keys are codes, metadata and metric fields only (`id, side, hand, conditions, tone, camera, legacy, unsuitable, unsuitableReason, visibility, uncertainCreases, found`). A POST containing `{x,y}` plus a `path` returned 422 `REPORT_REJECTED`. Coordinates exist only in annotation files on the dataset root, as designed. |
| Browser errors do not reveal sensitive paths | **PASS** | Missing image → `PATH_NOT_FOUND`. `eval/outputs/…` and `eval/consent/…` → 403 `FORBIDDEN`. Traversal → 404 `NOT_FOUND`. Server logs hold only method, route class and status (e.g. `GET eval/images 200`, `POST api/annotations 409`). |
| No unexpected persistent copies after closing | **PASS** (within limits, §3) | After annotate and evaluate: `localStorage` 0, `sessionStorage` 0, IndexedDB `[]`, Cache Storage `[]`, service workers 0, cookies empty. All responses carry `Cache-Control: no-store`. Files written during the test were only `annotations/S05-R-01.annotation.json` and `outputs/eval-…json` (both mode 600) inside the synthetic root. Nothing new in `~/Downloads`. No `eval/`, `images/`, `annotations/` or `outputs/` created in the repository. |
| Annotation flow end to end | **PASS** | Loaded `S05-R-01` by code (canvas 200×320; an orientation-6 source rendered upright). Two synthetic traces were drawn with real pointer drags. "Validate & save" → `Saved S05-R-01`; a second save → `ALREADY_EXISTS` (409, no overwrite). The saved traces were inside the image bounds. |
| Evaluation flow end to end | **PASS** | `?split=dev`: 2 images, 2 people, `INCONCLUSIVE … [SYNTHETIC TEST DATA]`, saved via `POST api/results` 201. Counts reported 1 unsuitable image; the pending A-09 notes were present. |

## 3. Limitations
- **Browser profile history.** The browser keeps ordinary history and possibly an in-memory cache of visited URLs. URLs contain image **codes** (e.g. `eval/images/P07-L-01.jpg`), not names. The decoded image exists in renderer memory while the page is open. For real data, use a dedicated browser profile or a private window and close it after each session (procedure).
- **Persistent-copy coverage.** The persistent-copy check covered web storage, caches, service workers, Downloads and the dataset or repository paths. It did not cover the browser's internal disk-cache files or OS swap.
- **Not the human's browser.** The test browser was the desktop app's built-in Chromium. The owner's everyday browser was not tested, though behaviour depends on standard web APIs only.
- **`validate.html` and `index.html` were not re-tested.** They are not dataset interfaces; per S-7, `validate.html` reads repository `testdata/` only.
- **Temporary preview configuration.** Preview configs were added to the main checkout's `.claude/launch.json` for this test and then **restored byte-for-byte** (`git diff` clean).
