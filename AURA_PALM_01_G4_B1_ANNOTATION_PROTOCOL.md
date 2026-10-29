# AURA-PALM-01-G4-B1: Annotation Protocol

**Status: PROPOSED. Annotation is on HOLD.** The annotation tool was **not** started. Terminology is **anatomical**; no palmistry terms or uncleared Palmistry content.

## 1. What to annotate (open palm, fingers up)

| Code | Crease | How to recognise it |
|---|---|---|
| **DTC** | Distal transverse crease | The upper horizontal crease of the palm, below the finger bases; usually starts at the little-finger side and runs toward the index/middle finger |
| **PTC** | Proximal transverse crease | The middle horizontal crease; usually starts near the index-finger side, above the thumb, and runs across the palm |
| **TC** | Thenar crease | The curved crease around the base of the thumb (thenar eminence), running from between thumb and index finger toward the wrist |
| **MINOR** | Other visible crease | Any other clear crease; matches with it are neither rewarded nor penalised (frozen criteria §3) |

**Rules:**
- Trace along the **centre** of the visible crease, from where it becomes clearly visible to where it fades.
- Use enough points to follow curvature (the tool samples about every 4 px while dragging).
- **Do not** trace finger edges, skin folds at the wrist, shadows, veins or image artefacts.
- If DTC and PTC merge into a single crease, annotate it as **DTC** and note "single transverse crease".

## 2. Uncertain, partial and unsuitable

| Situation | Action |
|---|---|
| A crease is partly visible (occluded or faint) | Trace only the visible part; mark **uncertain** |
| You aren't sure which crease it is | Mark it **MINOR** + **uncertain**; don't guess DTC/PTC/TC |
| Image unsuitable (wrong side, too dark or blurred to see creases, palm mostly occluded, identifying feature visible) | Mark the image **unsuitable** with a reason; don't trace. Unsuitable palm-side images still count for C1/C2 but not C3/C4 |
| Back-of-hand control | Set side = back; no crease tracing |

**Tool changes required before annotation (research code; pending authorization):**
- per-crease "uncertain" flag and an image-level "unsuitable + reason" field (schema `aura-palm-g4b-annotation/2`);
- the skin-tone selector replaced by a **read-only value transcribed from the consent form (self-report) or "not stated"**, never estimated by the annotator.

**Scoring proposal (owner decision; doesn't change the frozen rule):** creases marked uncertain are treated like MINOR. This needs a criteria change-log entry before any results are seen.

## 3. Format

One JSON per image: `{schema, imageId, width, height, hand, side, camera, phoneModel, conditions[], selfReportedSkinTone|"not stated", palmWidthPx|null, unsuitable:{flag, reason}, creases:[{type, uncertain, points:[{x,y}...]}], annotator: "A1"|"A2", annotatedAt}`. **Coordinates only, never image data.** Stored in `/Volumes/PALM_G4B_DATA/annotations/`.

## 4. Quality checks

1. **Self-check:** after each image, toggle the overlay and confirm the lines sit on the creases.
2. **Completeness:** every palm-side, suitable image has DTC, PTC and TC traced, or the omission is noted (not visible / uncertain).
3. **Spot audit:** the lead annotator reviews 10% of images.

## 5. Second annotator (optional, recommended)

- On **≥ 20%** of images (≥ 6), a second annotator traces independently, blind to the first.
- **Agreement:** apply the frozen matching rule between annotators (τ = 3% palm width). Report per-crease agreement rate.
- **Disagreement:** if agreement on a crease fails, a third person (or both together) reviews it. The resolved version is used for evaluation; both originals are kept for the agreement statistic.

## 6. Split separation (development vs held-out)

- Run `scripts/build-manifest.mjs` **once all annotations exist and before any evaluation**. It assigns participants to dev (~1/3) or held-out (~2/3) and writes `SPLIT_LOCK.json`.
- **Tuning uses only dev images.** Held-out images are not opened for tuning, and their per-image results aren't inspected until final evaluation.
- Adding participants later keeps existing assignments; `--relock` is forbidden unless logged with a reason.
- **AI-agent rule:** no AI assistant views images or image-rendering pages during annotation or evaluation (privacy risk register R-04).
