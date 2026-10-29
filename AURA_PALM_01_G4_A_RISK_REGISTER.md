# AURA-PALM-01-G4-A: Risk Register

| ID | Risk | Severity | Evidence | Mitigation / next step |
|---|---|---|---|---|
| G4-R1 | **MediaPipe telemetry** sends usage metrics to `odml.pa.googleapis.com` unconditionally (no opt-out found in 1.2.0) | **High** (privacy promise, "no transmission") | Bundle source; blocked request recorded twice | Strict CSP `connect-src 'self'` + network guard in any product page; consider patching or vendoring the bundle; re-check on every version bump |
| G4-R2 | **Palm-line detection unvalidated.** Classical filter finds finger edges and other dark lines; landmarks give no crease segmentation | **High** (product claim) | v0/v1 measurements; screenshot | Don't claim automatic line reading. Build a licence-cleared, consented evaluation set with ground truth before any accuracy claim; keep user confirmation/drawing as primary |
| G4-R3 | **No licence-cleared open-palm test images** | High (blocks validation) | Test set inventory | Owner-sourced, consented images with documented rights; or synthetic renders; define retention and deletion |
| G4-R4 | **Native camera unavailable**: no `NSCameraUsageDescription` (iOS), no `CAMERA` permission (Android) | Medium | Info.plist, AndroidManifest | A separate native gate. The photo-picker path may work without camera permission (unverified) |
| G4-R5 | Mobile performance and memory unknown (WASM 14.5 MB + model 7.8 MB download; CPU inference) | Medium | Desktop-only measurements | Device testing on low/mid-range iOS and Android; lazy-load only after consent; consider the GPU delegate |
| G4-R6 | Handedness / palm-facing inverted for non-mirrored (rear-camera) images | Medium | MediaPipe mirrored-label assumption; mirror test flips label | Track the capture source; let the user confirm the hand |
| G4-R7 | Biometric sensitivity: palm images and landmarks may be treated as biometric data under some laws | Medium | Nature of data | No storage, no upload, no identification (as prototyped); privacy/legal review before any product use |
| G4-R8 | Residual image data in browser/GPU memory after "End session" | Low | Can't be verified from JS | Disclose; release references; close model; avoid persistent caches for images |
| G4-R9 | Over-exposure not flagged | Low | Bright variants 182–202 not flagged | Tune thresholds on representative images |
| G4-R10 | Coupling to uncleared Palmistry content if integrated into `PalmistryView` | Medium (governance) | Architecture audit | Keep the scanner a separate module; no interpretation text; any future link to the guide waits for content approval |
| G4-R11 | Supply chain: fast-moving MediaPipe releases (nightlies daily) | Low | npm release history | Pin a version at least 2 weeks old; record asset SHA-256s (done); review diffs on upgrade |
| G4-R12 | App-store review for camera apps (usage strings, guideline 5.1 privacy) | Low–Medium | — | Address at the native gate |
