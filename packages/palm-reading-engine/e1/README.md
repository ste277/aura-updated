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
| `reference/` | The unmodified C1 reference oracle and checker (`check_examples.py`, `check_catalogue.py`, `mutation_tests_rev4.py`, `synthetic_reading_examples.json`), plus two harness scripts (`oracle_dump.py`, `run_reference.py`). This is an independent expected-output reference, not the engine. |
| `test/` | `node --test test/*.test.mjs`. Needs `python3` for the reference checks. |

## Input

```js
generateE1Reading({ featureSet, fingerBases }, { synthetic: true, mode: 'combined' | 'indian-only' | 'western-only' })
```

- `featureSet`: from `buildPalmFeatureSet()` (`palm-03-i1-feature-set@0.1.0`).
- `fingerBases`: from `palmFingerBases()` in `apps/web/lib/palm-analysis/fingerBases.ts`. These are landmarks 5, 9, 13 and 17 in the I1 palm frame.
- `{ synthetic: true }` is mandatory. Without it the call is refused (`synthetic-required`).

## Rules (C1 rev. 4)

- **Candidates:** **eligible-initial records only**. Later, held, excluded and historical records never enter a reading.
- **Ranking:** source support → suitability band → tradition. Indian is preferred only between comparably suitable candidates. There are no quotas.
- **Placement:** each item goes into the first category in its own list that has room. At most 2 items per section.
- **Boundaries:** values within a record's boundary margin show nothing, and the feature is listed as `boundary`.
- **Not assessed:** every feature that is not read gets one RC-13 reason code. `user-skipped` and `user-cannot-see` are never "not detected" (M4, E1-A1). Unassessed features are never confused with an observed absence (E1-A2).
- **Ceiling:** tentative for every item. Quality gates emission and is never displayed as confidence.

### Descriptor placeholders (C1 checklist C-8)

| Descriptor | Definition |
|---|---|
| Head slope | y(ulnar end) − y(radial end), in palm widths. This is the G6 definition. |
| Upward ending | The distal end's x, mapped to the nearest finger base |
| Heart ending | The radial end's x, mapped to one of four zones by anchors:<br>• index base;<br>• the midpoint between the index and middle bases;<br>• middle base;<br>• ring base. |
| Zone-edge margin | The record's `boundaryMargin` (0.08), capped at 25 % of the narrower adjacent zone. Without the cap, the "between index and middle" heart zone would be unreachable. |
