# PALM-03-E1: personalised interpretation engine (development only, synthetic only)

`aura.palm.e1-reading` 0.1.0 is a separate engine identity from the frozen G6 engine (`prototype/`). It composes a structured, tradition-attributed reading from a PALM-03-I1 feature set, using the C1 rev. 4 interpretation catalogue.

> **Content status.** The catalogue is `UNREVIEWED_RESEARCH_CONTENT`, and E1 never treats research eligibility as publication approval. The engine is unreachable from any route or UI. The `check-palm-e1-bundle.js` guard fails a production build that contains it, and that guard is unconditional.

## Layout

| Path | What |
|---|---|
| `library/catalogue.json`, `library/schema.json` | C1 rev. 4 catalogue and schema. Byte-identical to the C1 deliverables. |
| **`src/reading.ts`** | **The reading interface:** `generateSyntheticReading(input, { synthetic: true, mode })`. It builds the I1 feature set from **one** synthetic input, using the frozen I1 builder. |
| `src/engine-core.mjs` | Internal pipeline: verified construction → minted observations → reading |
| `src/construction.mjs` | Exact ports of the I1 frame, trace placement and ratio maths. They re-derive and verify everything E1 reads from the same input. |
| `src/observations.mjs` | Observations, with RC-13 reason codes. Only a minted observation set can be composed. |
| `src/compose.mjs` | `planSelection`: ids and codes only, never text.<br>`composeReading`: text, pinned library, minted observations, full output validation. |
| `src/library.mjs`, `src/schema-validate.mjs`, `src/packaged.mjs` | Loader and lint; the pinned packaged library |
| `src/descriptors.mjs`, `src/grid.mjs` | Descriptors and the I1 numerical contract |
| `reference/` | The C1 reference oracle and checker, corrected in R2. The originals are byte-identical in `reference/original-c1-rev4/`; see `reference/README.md`. |
| `test/` | `node --test test/*.test.mjs`. Needs `python3`. End-to-end tests: `test/palm03E1Engine.test.ts` at the repo root. |

## Interface and guarantees (R3)

```ts
generateSyntheticReading(input /* one synthetic PALM-03-I1 input */, { synthetic: true, mode?: 'combined' | 'indian-only' | 'western-only' })
```

**What the interface excludes:**
- There is **no** catalogue, schema, library, feature-set, finger-base or observation parameter. Unknown options are refused.
- The text-emitting path always uses the pinned packaged library.

**Construction (F6):**
- The I1 feature set is built inside the interface.
- The pipeline re-derives, from the same input:
  - the palm frame and finger bases;
  - every trace;
  - each line's state;
  - the two interpreted ratios;
  - the hand, quality and marks.
- It refuses any mismatch (`construction-mismatch`).
- No checksum or seal is used as proof of origin.

**Synthetic-only (F7):** every function able to emit a reading or a plan requires `{ synthetic: true }`. That includes the directly importable internals `composeReading`, `planSelection`, `deriveObservations` and `readingFromConstruction`. `composeReading` also accepts only observations minted by `deriveObservations`.

**Content (F2):**
- The complete output is validated before it is returned:
  - types;
  - fields;
  - prohibited and forecast wording in every string;
  - the pinned disclaimer frame;
  - pinned fallback codes.
- The loader rejects injected wording in reason texts and fallbacks.
- **Automated checks support, and never replace, editorial and safety review.**

**Conflicts (F4):**
- The loader rejects records whose clean match regions overlap for one observation.
- If two records ever qualify for one feature, neither is shown, and the feature is listed as `ambiguous-in-source`.

**Numbers (F5):**
- Values must lie on the I1 serialized grid, using I1's own rounding rule with no tolerance.
- A valid I1 value beyond ±1e6 withholds only the interpretation that depends on it (`value-outside-interpretable-range`).

**Guarantee:** a reading is internally consistent with the one supplied synthetic input. It does **not** prove physical-hand identity or image provenance; that belongs to the later scanner and real-image validation milestone.

### Development-only privacy-gate exception (G5 B2, owner-authorised 2026-11-26)

G5 check B2 normally allows only the palm-scan UI to import `lib/palm-analysis`.

**The exception:**
- It covers exactly `src/reading.ts`.
- It allows exactly one statement: `import { buildPalmFeatureSet, type PalmFeatureSetInput } from '…/lib/palm-analysis/features'`.

**Compensating checks** in `test/palmG5I1PrivacyGate.test.ts`:
- B2 now also resolves relative and dynamic imports.
- B2b: no module in `apps/web` or `packages/` reaches `reading.ts`, directly or indirectly, and only listed test consumers import it.
- B2c: negative fixtures show that unauthorised imports still fail.

## Rules (C1 rev. 4)

- **Candidates:** **eligible-initial records only**. Later, held, excluded and historical records never enter a reading.
- **Ranking:** source support → suitability band → tradition. Indian is preferred only between comparably suitable candidates. There are no quotas.
- **Placement:** each item goes into the first category in its own list that has room. At most 2 items per section.
- **Boundaries:** values within a record's boundary margin show nothing, and the feature is listed as `boundary`.
- **Not assessed:** every feature that is not read gets one RC-13 reason code. `user-skipped` and `user-cannot-see` are never "not detected" (M4, E1-A1). Unassessed features are never confused with an observed absence (E1-A2).
- **Ceiling:** tentative for every item. Quality gates emission and is never displayed as confidence.

### Numerical equality (R2 F5, revised in R3)

All comparisons are exact integer steps of 0.0001: the grid I1 serializes to.
- **Membership:** a value is on the grid iff `Math.round(v * 1e4) / 1e4 === v`, the same rounding I1 applies, with **no tolerance**. So 0.20000000001 is off the grid.
- **Closed bands:** ties, gaps, margins and thresholds are closed. A distance equal to the tolerance counts as inside it.
- **Magnitude:** valid I1 values beyond ±1e6 are withheld for that interpretation only.

### Descriptor placeholders (C1 checklist C-8)

| Descriptor | Definition |
|---|---|
| Head slope | y(ulnar end) − y(radial end), in palm widths. This is the G6 definition. |
| Upward ending | The distal end's x, mapped to the nearest finger base |
| Heart ending | The radial end's x, mapped to one of four zones by anchors:<br>• index base;<br>• the midpoint between the index and middle bases;<br>• middle base;<br>• ring base. |
| Zone-edge margin | The record's `boundaryMargin` (0.08), capped at 25 % of the narrower adjacent zone. Without the cap, the "between index and middle" heart zone would be unreachable. |

## Provisional synthetic-development policies (pending owner disposition)

None of these is a content or anatomical approval. C-8 and C-12 remain pending.

| ID | Policy |
|---|---|
| V-A | The zone-edge margin is capped at 25 % of the narrower adjacent zone |
| V-B | Adjacent-zone suppression: near an edge, a record on *either* side is suppressed. The diagnostic is `boundary`, where the C1 oracle says `no-supported-content` just inside an unsupported zone. |
| V-C | Uncertain measurements are withheld with `measurement-unavailable` (detail `uncertain:…`), or `quality-gated` when frame quality is not accepted |
| V-D | `palmFacing: null` is allowed for synthetic confirmed traces. `false` and unknown quality are gated. To be reassessed before any real input. |
| V-E | `observed-absent` is a distinct state available only through synthetic observation fixtures; I1 has no such input |
| V-F | Generated synthetic hands (varied proportions, rotations, mirroring, narrow zones, uncertain measurements), and construction from one input (R3; the R2 seal is removed). Not real-hand validation. |
| V-G | The unreviewed catalogue is committed for development only and excluded from every release build path |

## Release exclusion

`apps/web/scripts/check-palm-e1-bundle.js` scans **every** shipped file byte-wise, whatever its extension:
- `.next/static`;
- `.next/server`;
- `.next/standalone`, including its shipped `node_modules`;
- `public/`.

A symlink that leaves the scanned tree is a scan error, so the scan fails closed. The guard runs in:
- the CI "Next.js production build" job;
- `vercel-build.sh`, for every Vercel Preview and Production build;
- the Docker build stage;
- the Docker `release-tree` stage, with `--tree /app` over the exact runtime tree, which also covers `migrations/`.

It is unconditional. `test/palm03E1ReleaseGuards.test.ts` and the package `guard.test.mjs` cover it.
