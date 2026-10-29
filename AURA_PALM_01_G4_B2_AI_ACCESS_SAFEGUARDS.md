# AURA-PALM-01-G4-B2: AI Access Safeguards

**Owner acknowledgment of safeguard A-12: PENDING** (not yet provided).

## 1. Why

When an AI assistant (including Claude in this app) **opens, reads, screenshots or describes** a file or page, that content is sent to the model provider. A participant palm photo viewed this way would leave the device, breaking the consent terms (no cloud processing).

## 2. Rules

| # | Rule |
|---|---|
| S-1 | AI assistants **must not open, read, preview or describe** participant images (no file reads, no image viewers, no `strings`/hex dumps of image files). |
| S-2 | **No screenshots** or page reads of any page while it shows participant images: the prototype app (`index.html`), the annotation tool (`annotate.html`), or Finder/Preview windows. |
| S-3 | **No uploads** of images or image-derived data to any model provider, cloud service or chat. |
| S-4 | **No image-derived biometric templates in AI-visible output:** no hand landmarks, palm polygons, crease coordinates or per-image feature vectors in anything an AI reads. Annotation JSON (coordinates) is **not** opened by AI assistants. |
| S-5 | Local scripts may process images (strip metadata, run evaluation). Only **aggregate, non-identifying results** are returned to an AI: counts, rates, Wilson intervals, latency, and per-image **codes with pass/fail metrics** (no coordinates). |
| S-6 | Terminal output from scripts run by an AI must not echo image bytes, EXIF dumps or coordinates (scripts print names, dimensions and pass/fail only). |
| S-7 | `validate.html` (it renders an image gallery) is **never** pointed at participant data. It reads only `testdata/` (public MediaPipe test assets). |
| S-8 | Humans annotate and review images **without** an AI assistant attached to that window or file. |

## 3. Verification of current research code

| Component | Behaviour | Complies? |
|---|---|---|
| `src/evaluate.js` / `evaluate.html` | Draws images only on **off-screen** canvases; no gallery; `window.__eval` contains counts, rates, Wilson intervals, latency and per-image `{id, side, conditions, tone, camera, tol, suggestions, matched, falsePositives, recalled, effort, ms}`. **No landmarks, polygons or crease points** (code inspected: no `landmarksPx`, `palmPolygon` or `points` in output) | **Yes** (S-4, S-5) |
| `src/validate.js` / `validate.html` | Renders a gallery with overlays | Only with `testdata/` (S-7) |
| `index.html` (app), `annotate.html` | Display images to the human user | AI must not view (S-2) |
| `scripts/strip_metadata.sh`, `verify_clean.sh` | Print file names, dimensions, CLEAN/FAIL only | **Yes** (S-6) |
| `scripts/build-manifest.mjs` | Prints counts only | **Yes** |
| Privacy guard + CSP | Block all non-local network requests from research pages | **Yes** (verified on desktop) |

## 4. Residual risks

- Rules depend on human discipline. An accidental screenshot by an assistant would transmit an image. Mitigation: run real-data evaluations in a session with the browser pane closed; the AI reads only `window.__eval` (or a JSON file) produced by the harness.
- Per-image codes plus conditions are low-sensitivity but not anonymous to the owner (who holds any key).

## 5. Owner acknowledgment

| Field | Value |
|---|---|
| I acknowledge rules S-1 to S-8 and will enforce them during collection, annotation and evaluation | ☐ (PENDING) |
| Name / date | |
