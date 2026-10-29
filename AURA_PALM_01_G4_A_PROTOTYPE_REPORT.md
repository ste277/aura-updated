# AURA-PALM-01-G4-A: Prototype Report

**Date:** 2026-11-11 · **Branch:** `research/palm-g4a-scan-prototype` (local worktree `.claude/worktrees/palm-g4a-scan`, from `origin/main` @ `1741a95`). **Uncommitted, unpushed, not merged.** Not part of `apps/web`; never built or deployed.

## 1. Files (all new, under `research/palm-scan-g4a/`)

| File | Purpose |
|---|---|
| `package.json`, `package-lock.json` | Pins `@mediapipe/tasks-vision` **1.2.0** |
| `scripts/setup.sh` | Installs the runtime and copies it to `vendor/`; downloads the model to `models/`; records `models/ASSET_SHA256SUMS` |
| `index.html` | Prototype UI with strict CSP (`connect-src 'self'`), `no-referrer` |
| `validate.html` | Validation harness |
| `src/privacy-guard.js` | Blocks non-same-origin fetch/XHR and all `sendBeacon`; records attempts |
| `src/pipeline.js` | Local model load, detection, quality, orientation, gated crease candidates, disposal |
| `src/geometry.js`, `src/quality.js`, `src/creases.js`, `src/overlay.js` | Palm polygon/orientation; quality checks; experimental crease filter; drawing |
| `src/app.js` | Consent gate, camera on explicit click, image picker, overlay, accept/reject, draw, end-session disposal |
| `.gitignore` | Excludes `node_modules/`, `vendor/`, `models/*.task`, `testdata/` |

**Not changed:** `apps/`, `packages/`, Palmistry content, the frozen PDF, licensing evidence, governance records. The main checkout is unchanged.

## 2. Test data (licence-cleared, not committed)

- 8 images from MediaPipe's test assets (`storage.googleapis.com/mediapipe-assets/`, referenced by the Apache-2.0 MediaPipe repository build files), plus 27 locally generated degraded variants (blur σ4/σ9, dark, bright, rotate 90/180, mirror, centre occlusion, 1/3 scale). Total **35**; checksums in `testdata/SOURCE_SHA256SUMS`.
- **Limitation:** none shows an open palm with visible creases. The two-hand images show the **backs** of hands; the gesture images show palms partly covered by fingers. **No uncleared Palmistry illustrations or text were used.**

## 3. Tests executed and measured outcomes

Environment: Claude desktop browser pane (Chromium 156, Electron), macOS, Intel. **Not a mobile device.**

| Test | Result |
|---|---|
| Detection (35 images) | **32/35** detected. Misses: `victory__occluded`, `pointing_up__occluded` (centre blocked), `pointing_up__blur9` |
| Handedness | Originals match file names (right/left); **mirroring flipped the label 3/3** |
| Left vs right | Left and right test sets both detected with scores 0.95–0.97 (two-hand images) and 0.98–0.99 (single-hand) |
| Orientation: rotation | Correctly reported (e.g. originals about −18° to 6°; rotated sets 82° / −98° / 172°) and flagged when \|rotation\| > 45° |
| Orientation: palm-facing heuristic | Correct on **32/32** detections (13 back-of-hand → "no"; 19 palm-side → "yes"), on this set only |
| Quality: blur | Sharpness 2–3 for blurred vs 80–1014 for originals → flagged **6/6** detected blur variants |
| Quality: dark | Brightness 21–24 → flagged **3/3** |
| Quality: bright | Brightness 182–202 → **not flagged** (threshold 215 too lenient) |
| Crease candidates, v0 (ungated) | 1–3 candidates on **every** detected image, **including all 13 back-of-hand images and degraded images**: false positives |
| Crease candidates, v1 (gated) | **0** on back-of-hand (13/13) and **0** on degraded images; 1–3 on palm-side gestures, which **visually trace folded-finger edges** (screenshot inspection). **Accuracy on real palm creases: UNVERIFIED** |
| Model load (local) | 210–250 ms |
| Detection time | Run 1 median about 57 ms (55–85; first call 168 ms); run 2 median 232 ms (120–386). **The pane is not a controlled benchmark** |
| Post-processing | Median 12.5 ms (0.9–64) |
| JS heap | About 2→25 MB (run 1). WASM/GPU memory **not measured** |
| Privacy: network | **Only `127.0.0.1` requests** in the browser network log. MediaPipe telemetry to `odml.pa.googleapis.com` attempted and **blocked** (both runs) |
| Privacy: consent / camera | Camera and picker disabled until consent; camera requested **only** on click |
| Camera capture | Browser pane **blocks camera**; the page fell back cleanly ("NotAllowedError"). **Real camera capture: UNVERIFIED** |
| User correction | Accept/reject toggle **worked**; free-hand crease drawing **worked** (desktop pointer) |
| End session | Canvas reset to 0×0, results hidden, no media stream, **localStorage/sessionStorage/cookies empty**, model closed |
| Mobile browsers (iOS Safari, Android Chrome) | **UNVERIFIED** (no device testing available) |
| iOS/Android WebView camera | **Not testable** without native permission changes (see the architecture audit) |

## 4. Fixes made during testing

1. **v1 crease gate:** candidates only for palm-facing, photometrically acceptable images. This eliminated the measured back-of-hand and degraded false positives.
2. "Choose image" is now visibly disabled until consent (it was functionally disabled but looked enabled).

## 5. Unresolved issues

- Palm-crease detection quality is unknown (no ground truth). The remaining candidates are finger edges on these images.
- Over-exposure threshold too lenient.
- Handedness and palm-facing depend on MediaPipe's mirrored-image assumption: rear-camera photos will report the opposite hand.
- Telemetry must be blocked in any production use.
- No measurement on mobile or low-end devices; WASM memory unmeasured.
- Image buffers are released by the app, but browser and GPU internals can't be verified to be wiped.

## 6. How to run (local)

```bash
cd research/palm-scan-g4a && sh scripts/setup.sh && python3 -m http.server 8765 --bind 127.0.0.1
```

Then open `http://127.0.0.1:8765/index.html` (or `validate.html` after placing test images in `testdata/` with a `manifest.json`).
