# AURA-PALM-01-G4-A: Technology Evaluation

**Date:** 2026-11-11 · Package facts come from the npm registry (2026-11-11). "Measured" means measured in this work; everything else is assessment.

## 1. Candidates

| Option | Licence | Size | Maintenance | Fit |
|---|---|---|---|---|
| **MediaPipe Tasks Vision: HandLandmarker** (`@mediapipe/tasks-vision`) | Apache-2.0 | npm unpacked 31 MB. Runtime needed: `vision_bundle.mjs` 156 KB + WASM 14.5 MB + model `hand_landmarker.task` 7.8 MB (**measured**) | Active (stable 1.2.2 on 2026-11-03; nightly daily). Prototype pins **1.2.0** (2026-10-27, more than 2 weeks old) | 21 hand landmarks + handedness, in-browser WASM/WebGL. **Selected for detection and landmarks** |
| TF.js `@tensorflow-models/hand-pose-detection` | Apache-2.0 | 0.9 MB + TF.js runtime + model | Last release 2023-10 (stale) | Similar landmarks; older; heavier runtime. Not selected |
| OpenCV.js (`@techstark/opencv-js`) | Apache-2.0 | 14.7 MB | Active | Classical image processing (ridge/edge filters). **Not needed**: the crease filter was written in plain JS (~150 lines) to avoid 14 MB |
| ONNX Runtime Web + a palm-line segmentation model | MIT (runtime) | 150 MB unpacked runtime + model | Active | Could run a learned crease-segmentation model, but **no licence-cleared, validated palm-line model or dataset was identified**. Research models and datasets have unclear licences and biometric-data provenance |
| Cloud vision APIs | — | — | — | **Excluded** (no external inference) |

## 2. Capability-by-capability

| Capability | Approach | Status |
|---|---|---|
| 1. Hand/palm detection | MediaPipe HandLandmarker (IMAGE mode, CPU delegate, up to 2 hands) | **Measured feasible**: 32/35 test images (§3) |
| 2. Landmarks | MediaPipe 21-point model | **Measured feasible** |
| 3. Image quality | Classical checks in the palm polygon: brightness mean, contrast SD, Laplacian-variance sharpness, palm area fraction, in-frame, rotation | **Measured**: blur/dark/rotation flagged reliably; over-exposure **not** flagged at current thresholds |
| 4. Orientation | Rotation from wrist→middle-MCP; palm-vs-back heuristic from landmark winding + handedness label | **Measured** correct on all 32 detections in this set; **heuristic**, depends on the mirrored-label assumption |
| 5. Major palm-line detection | Multi-scale Hessian ridge filter in the palm polygon → connected components → polylines; **gated** to palm-facing, photometrically acceptable images | **Unvalidated.** Hand landmarks **do not** provide palm-line segmentation. The classical filter finds dark linear structure, including finger edges, which is not the same as palm creases. No open-palm ground-truth images were available |
| 6. User correction | Tap to accept/reject candidates; free-hand drawing of a crease; undo | **Implemented and exercised** in the prototype (desktop pointer only) |

## 3. Key measured facts

- **MediaPipe telemetry:** the bundle constructs a logger **unconditionally** for every task. It POSTs protobuf usage metrics (task type, latency and count statistics) to `https://odml.pa.googleapis.com/v1/log` every 60 s and on close. No disable option was found in 1.2.0. It was **blocked** in the prototype by CSP `connect-src 'self'` plus a fetch/XHR/beacon guard; the browser network log shows **no** non-local request. **Any production use must keep this blocked or patch it out.**
- All runtime assets are served locally (WASM, model, bundle). No CDN.

## 4. Recommendation

- **Use MediaPipe HandLandmarker** (self-hosted, telemetry blocked) for detection, landmarks, orientation and quality gating.
- **Do not** promise automatic palm-line reading. Treat crease output as user-assisted: detector suggestions the user confirms or draws, or keep it manual only, until a licence-cleared evaluation set with ground truth exists and an approach meets agreed accuracy.
