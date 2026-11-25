# PALM-03-E1: personalised interpretation engine (development only, synthetic only)

`aura.palm.e1-reading` 0.1.0 is a separate engine identity from the frozen G6 engine (`prototype/`). It composes a structured, tradition-attributed reading from a PALM-03-I1 feature set, using the C1 rev. 4 interpretation catalogue.

> **Content status.** The catalogue is `UNREVIEWED_RESEARCH_CONTENT`, and E1 never treats research eligibility as publication approval. The engine is unreachable from any route or UI. The `check-palm-e1-bundle.js` guard fails a production build that contains it, and that guard is unconditional.

## Layout

| Path | What |
|---|---|
| `library/catalogue.json`, `library/schema.json` | C1 rev. 4 catalogue and schema. Byte-identical to the C1 deliverables. |
| `src/library.mjs` | Loader (capability E1-E1):<br>• schema validation, with only supported keywords allowed (`src/schema-validate.mjs`);<br>• the C1 content policy, ported line by line from `reference/check_catalogue.py`;<br>• the 29-record inventory manifest;<br>• the E1 capability check. |
| `src/descriptors.mjs` | Essential descriptors (E1-E4, E1-E5): head slope, the upward line's ending zone, the heart line's ending zone, finger-base checks and boundary margins |
| `src/observations.mjs` | I1 feature set + finger bases → observations. The feature set is validated by the I1 contract (`adapter/feature-set-adapter.mjs`, validation only). |
| `src/compose.mjs` | Deterministic selection, placement and composition (E1-E2): three modes, RC-1 to RC-14 |
| `src/index.mjs` | `generateE1Reading(input, { synthetic: true, mode })`, `composeFromObservations(...)`, `loadLibrary(...)` |
| `reference/` | The C1 reference oracle and checker, corrected in R2 (originals preserved byte-identical in `reference/original-c1-rev4/`; see `reference/README.md`), plus harness scripts. This is an independent expected-output reference, not the engine. |
| `test/` | `node --test test/*.test.mjs`. Needs `python3` for the reference checks. |

## Input

```js
generateE1Reading(envelope, { synthetic: true, mode: 'combined' | 'indian-only' | 'western-only' })
```

- **The envelope:** built by `buildPalmE1Observation(input)` in `apps/web/lib/palm-analysis/fingerBases.ts` from **one** I1 input. It contains:
  - the feature set (`palm-03-i1-feature-set@0.1.0`);
  - the palm-frame finger bases (landmarks 5, 9, 13 and 17);
  - a frame id;
  - a SHA-256 seal.
- **Frame pairing (R2, finding F6):** E1 recomputes the seal and refuses any mismatch with `frame-mismatch`. That covers finger bases from another hand, a different frame id, or a feature set or finger bases edited after sealing. The seal guards against mispairing; it is not a keyed signature.
- **Synthetic declaration (R2, finding F7):** `{ synthetic: true }` is mandatory for **every** reading entry point, `generateE1Reading` and `composeFromObservations` alike. Without it the call is refused with `synthetic-required`. The internal `composeReading` and `deriveObservations` are not exported.
- **Library (R2, finding F1):** a `library` option must be one returned by `loadLibrary()`. The validated library is deep-frozen and exposes no writable map. Eligibility is re-checked against the pinned manifest at composition.

## Rules (C1 rev. 4)

- **Candidates:** **eligible-initial records only**. Later, held, excluded and historical records never enter a reading.
- **Ranking:** source support → suitability band → tradition. Indian is preferred only between comparably suitable candidates. There are no quotas.
- **Placement:** each item goes into the first category in its own list that has room. At most 2 items per section.
- **Boundaries:** values within a record's boundary margin show nothing, and the feature is listed as `boundary`.
- **Not assessed:** every feature that is not read gets one RC-13 reason code. `user-skipped` and `user-cannot-see` are never "not detected" (M4, E1-A1). Unassessed features are never confused with an observed absence (E1-A2).
- **Ceiling:** tentative for every item. Quality gates emission and is never displayed as confidence.

### Numerical equality (R2, finding F5)

All comparisons are exact integer steps of 0.0001: the grid I1 serializes to. Ties, gaps, margins and thresholds are **closed**, meaning a distance equal to the tolerance counts as inside it. Values off the grid are refused, never rounded.

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
| V-F | Generated synthetic hands (varied proportions, rotations, mirroring, narrow zones, uncertain measurements) and a sealed frame pairing. Not real-hand validation. |
| V-G | The unreviewed catalogue is committed for development only and excluded from every release build path |

## Release exclusion

`apps/web/scripts/check-palm-e1-bundle.js` runs:
- in the CI "Next.js production build" job;
- in `apps/web/scripts/vercel-build.sh`, for every Vercel Preview and Production build;
- in the `deploy/Dockerfile` build stage.

It is unconditional and fails closed. `test/palm03E1ReleaseGuards.test.ts` covers all three paths.
