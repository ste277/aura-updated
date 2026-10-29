# AURA-PALM-01-G4-B2A — Annotation Schema v2

**Identifier:** `aura-palm-g4b-annotation/2` · **Implementation:** `research/palm-scan-g4a/src/annotation-schema.js` (shared by the browser tool, server, manifest builder and evaluator)

## 1. Record
| Field | Rule |
|---|---|
| `schema` | `aura-palm-g4b-annotation/2` (or `/1`, legacy) |
| `imageId` | Participant code only: `^[A-Z0-9]{2,8}(-[A-Z0-9]{1,4}){1,3}$`, e.g. `P07-L-01`. Rejects names and paths. |
| `width`, `height` | Positive integers |
| `hand` | `Left` \| `Right` |
| `side` | `palm` \| `back` |
| `camera` | `rear` \| `front` \| `other` |
| `selfReportedSkinTone` | `group1` \| `group2` \| `group3` \| `not stated`. Copied from the consent form; **never estimated**. Fitzpatrick or other inferred labels are rejected. |
| `conditions` | Short free-text tags (bounded) |
| `unsuitable` | `{flag:false}` or `{flag:true, reason}`, where reason ∈ `wrong_side`, `too_dark`, `too_blurred`, `occluded`, `identifying_feature`, `other` |
| `creaseVisibility` | For a suitable palm image: `{DTC, PTC, TC}`, each `confident` \| `uncertain` \| `not_visible`. `null` for back-of-hand or unsuitable images. |
| `creases[]` | `{type: DTC\|PTC\|TC\|MINOR, status: confident\|uncertain, points:[{x,y}…]}`. At least 2 points, all inside image bounds; at most 5000 in total. |
| `annotator` | `A\d` |
| `annotatedAt` | ISO-8601 |
| `palmWidthPx` | Number or `null` |

## 2. Consistency rules (record rejected if violated)
- A crease marked `not_visible` must have no trace.
- A crease marked confident or uncertain must have a trace, with `status` equal to the visibility value.
- Back-of-hand or unsuitable images must have no traces.
- An unsuitable flag requires a reason.

## 3. Backward compatibility
v1 records (no visibility or status) are accepted **read-only**. Each crease gets `status: 'unspecified'`, `creaseVisibility` is `null`, and the record is counted under `legacyV1`. The server **refuses to save** v1 records, so new annotations must be v2.

## 4. Scoring (unchanged; A-09 pending)
`scoreImage` and the frozen rule (τ = 3% palm width, ≥70% of points within τ, ≥50% coverage) are untouched. Uncertain traces are currently scored as ordinary annotations. Unsuitable images are scored as they are and flagged per image. Reports list both under `pendingDecisions`. **Treating uncertain creases as MINOR, and excluding unsuitable images, remain owner decisions (A-09).**

## 5. Privacy
`annotationSummary()` produces the coordinate-free fields allowed in reports. Coordinates exist only in annotation files inside `<root>/annotations` on the encrypted volume. The annotation tool saves only through the guarded server; it has no download path.

## 6. Tests (synthetic)
Valid v2 (incl. uncertain and not_visible) accepted. Unusable image with reason accepted, without reason rejected. Non-object, unknown schema, name-like id, out-of-bounds point, not_visible-but-traced, status mismatch, inferred skin tone, and back-of-hand traces all rejected. Legacy v1 read with `unspecified`. Summary has no coordinates. Server: duplicate save → 409, malformed or traversal id → 422. **All PASS.**
