# AURA-PALM-01-G4-A: Architecture Audit

**Date:** 2026-11-11 · **Baseline:** `origin/main` @ `1741a95` (read-only)

## 1. Palmistry structure and entry points

| Item | Finding |
|---|---|
| Content | `packages/palmistry/src/content.ts`, `sources.ts`, `review-status.json` (`PENDING_HUMAN_REVIEW`) |
| UI | `apps/web/components/PalmistryView.tsx` (guide), `PalmHandDiagram.tsx` (inline SVG: "no image file, no canvas, no dependency") |
| Entry | Explore → fourth card → `'palmistry'` tab in `apps/web/app/page.tsx` |
| Gating | Runtime gate `isPalmistryAvailable()`, plus a **build-time exclusion**: every `next build` swaps `PalmistryView` for an empty stub until approval (`palmistry-build-exclusion.js`); scanners in CI and the Vercel build |
| Coupling risk | Anything added *inside* `PalmistryView` is excluded from production with the uncleared content, but would also be coupled to it. **A scanner must be a separate module** with no imports from `packages/palmistry` and no reuse of the diagram or interpretation text |

## 2. Existing image capture / upload / CV

**None.** There is no `getUserMedia`, no `type="file"`, no `FileReader`/`createObjectURL`, no `<canvas>` processing, and no TF.js, MediaPipe, ONNX or OpenCV dependency in `apps/web` or `packages`. The D1 audit's conclusion stands: any photo feature is a net-new capability.

## 3. Browser camera permissions and headers

| Item | Finding |
|---|---|
| CSP / Permissions-Policy headers | **None configured** (`next.config.js` sets no headers; no middleware headers). A scanner page needs a strict CSP (`connect-src 'self'`) and `Permissions-Policy: camera=(self)` |
| Secure context | `getUserMedia` requires HTTPS (or localhost). Production web is HTTPS |

## 4. iOS / Android WebView constraints

| Platform | Finding | Implication |
|---|---|---|
| Shell | Capacitor 6, remote-URL mode (`capacitor.config.ts`); app ID `com.greenarrow.auraschedule` | The web scanner runs inside the WebView |
| **iOS** (WKWebView) | `Info.plist` has **no `NSCameraUsageDescription`** | iOS terminates apps that access the camera without the usage string. In-app camera **won't work** without a native change. WKWebView `getUserMedia` also needs iOS 14.3+ and HTTPS |
| **Android** (WebView) | `AndroidManifest.xml` declares only `INTERNET`, **no `CAMERA`** | Capacitor's WebChromeClient can't grant the WebView camera permission without the manifest permission and a runtime prompt |
| Both | File/photo picking via `<input type=file accept="image/*">` generally works in WebViews (system picker) | A **photo-selection** path is feasible without camera permissions; the camera path needs native config (a production change, out of G4-A scope) |

## 5. Security and privacy controls present

- Analytics: closed `ProductEventName` taxonomy with a forbidden-metadata denylist (`lib/productEvents.ts`). Palmistry emits only `PALMISTRY_GUIDE_OPENED` (no metadata). A scanner would need **no** image-derived analytics.
- No image storage in Prisma (no binary columns); no blob storage SDK.
- No existing Permissions-Policy or CSP.

## 6. Conclusion

A **safe isolated prototype path exists**: a standalone, browser-only page outside `apps/web`, with no imports from Palmistry content, local-only model assets, a strict CSP and a network guard. Native camera support and any integration into Aura are **separate, later gates** (native config changes, CSP headers, the publication gate).
