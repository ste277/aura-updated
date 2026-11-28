# PALM-03-E1: personalised interpretation engine (development only, synthetic only)

`aura.palm.e1-reading` 0.1.0 is a separate engine identity from the frozen G6 engine (`prototype/`). It composes a structured, tradition-attributed reading from a PALM-03-I1 feature set, using the C1 rev. 4 interpretation catalogue.

> **Content status.** The catalogue is `UNREVIEWED_RESEARCH_CONTENT`, and E1 never treats research eligibility as publication approval. No route reaches the engine. Since D6-I1 (ticket 50368), exactly one UI module, the development-gated scanner (`PalmImageInput.tsx`, which every production build swaps for a stub), calls `generateConfirmedScannerReading`; that entry point refuses unless `NODE_ENV` is `development` and the image-input flag is set. The `check-palm-e1-bundle.js` guard fails a production build that contains E1, and that guard is unconditional. The library is loaded from `library/packaged-content.mjs`, a generated, byte-checked copy of the two JSON files, so the same loader runs in Node and in a browser.

## Layout

| Path | What |
|---|---|
| `library/catalogue.json`, `library/schema.json` | C1 rev. 4 catalogue and schema. Byte-identical to the C1 deliverables. |
| **`src/reading.ts`** | **The reading interface and the only reading pipeline** (R5): `generateSyntheticReading(input, { synthetic: true, mode })`. It binds the frozen I1 builder at load. It then checks the declaration, snapshots the input, builds the I1 feature set from the snapshot and verifies the construction. Finally it derives observations and text, all in module-private functions. Nothing is claimable or injectable. |
| `src/construction.mjs` | Exact ports of the I1 frame, trace placement and ratio maths. They re-derive and verify everything E1 reads from the same input. |
| `src/compose.mjs` | `planSelection`: ids and codes only, never text.<br>`validateReadingOutput`: the full output check. No text composer is exported (R4). |
| `src/library.mjs`, `src/schema-validate.mjs`, `src/packaged.mjs` | Loader and lint. `packaged.mjs` reads the two library files once, as bytes; checks them against the C1 rev. 4 SHA-256 digests; parses and deep-freezes them at initialization; and validates them once. No raw catalogue or schema object is exported (R4). |
| `src/descriptors.mjs`, `src/grid.mjs` | Descriptors and the I1 numerical contract |
| `reference/` | The C1 reference oracle and checker, corrected in R2. The originals are byte-identical in `reference/original-c1-rev4/`; see `reference/README.md`. |
| `preview/` | **PALM-04-I4 standalone reading preview harness (G-6, D1).** It replays confirmed synthetic scanner-journey fixtures into a reading (JSON or HTML). See `preview/README.md`. |
| `test/` | `node --test test/*.test.mjs`. Needs `python3`. End-to-end tests: `test/palm03E1Engine.test.ts` at the repo root. |

## Interface and guarantees (R3)

```ts
generateSyntheticReading(input /* one synthetic PALM-03-I1 input */, { synthetic: true, mode?: 'combined' | 'indian-only' | 'western-only' })
```

**What the interface excludes:**
- There is **no** catalogue, schema, library, feature-set, finger-base or observation parameter. Unknown options are refused.
- The text-emitting path always uses the pinned packaged library.

**One authoritative snapshot (R6):** `identity.mjs` `captureOwnData` is the single capture primitive. Everything the pipeline consumes passes through it exactly once: the options, the caller's input, the builder's feature set (captured *before* it is validated), every construction and descriptor result, the observations and the plan. It reads each object's prototype, keys and own descriptors once, accepts own data properties only, and returns a new deep-frozen null-prototype structure. Validation and composition then use only that captured structure, so a getter, proxy or later mutation cannot show one state to validation and another to composition. Data-keyed maps in the planner and linter are null-prototype, and intermediate records are tagged (no optional-field probing). Anything that cannot be captured fails closed.

**Construction (F6; one path since R4, no external authority since R5):**
- No exported function accepts a builder, a feature set or derived observations. The pipeline in `reading.ts`:
  - takes one plain-data snapshot of the input (accessors and non-plain objects are refused);
  - builds the I1 feature set from that snapshot;
  - re-derives from the same snapshot, and compares field by field:
    - the palm frame and finger bases;
    - palm facing;
    - every trace and each line's exact state (placed points, or the specific unassessed reason; a port of I1 `placeTrace`);
    - the two interpreted ratios, with their availability, status and reasons;
    - the hand, quality and each mark's exact state.
- It refuses any mismatch (`construction-mismatch`). This also holds if code that loads first replaces the I1 module's exported builder before `reading.ts` binds it (initialization order).
- No checksum or seal is used as proof of origin.

**Synthetic-only (F7):** the reading interface and `planSelection` use one check (`requireSyntheticOptions`), run before any work. It requires an **own data** property `synthetic` that is exactly `true`, on a plain options object. A data property is decided from the descriptor's own fields, so an accessor paired with an inherited `Object.prototype.value` is refused (R5). Omitted, inherited, `false`, boxed, non-boolean and malformed declarations are also refused. No other exported function produces a reading or a plan.

**Content (F2):**
- **Integrity (R5):** the loader normalizes the catalogue, the schema and any observations into private null-prototype records holding only their own data, recursively (`normalizeRecord`). An inherited value for an absent optional field therefore cannot affect eligibility, matching, wording, diagnostics or output metadata. The schema then restricts each record to its permitted fields. The pipeline's own intermediate objects are read through own-property checks.
- **Immutability (R4):** the packaged catalogue and schema are immutable from initialization. They are read once from their pinned C1 rev. 4 bytes and deep-frozen before validation. Validation and reading generation use the same frozen object, and no mutable reference is exported. Altered bytes make the engine fail to load.
- The complete output is validated before it is returned:
  - types;
  - fields;
  - prohibited and forecast wording in every string;
  - the pinned disclaimer frame;
  - pinned fallback codes.
- The loader rejects injected wording in reason texts and fallbacks.
- Defence in depth (R4): the prohibited vocabulary also covers medical claims (diagnoses, conditions, treatment). It is never the integrity mechanism.
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

**Positive artifact verification (R4).** Before scanning, the guard checks that the expected artifact is there, for each build target (`REQUIRED` in the script):
- **`web-build`** (`apps/web` after `next build`, standalone output; used by CI, Vercel and the Docker build stage):
  - a valid `.next/BUILD_ID`, with `.next/static/<id>/_buildManifest.js` present;
  - a non-empty `.js` chunk under `.next/static/chunks`;
  - `.next/server/webpack-runtime.js`, plus non-empty output under `.next/server/app`;
  - parseable `app-paths-manifest.json` and `pages-manifest.json`;
  - exactly one standalone app root, located: `server.js` beside a `.next/BUILD_ID` equal to the build's (CI and Docker: `.next/standalone`; Vercel: `.next/standalone/apps/web`), with server output;
  - `package.json` and `node_modules/next` in that root or an ancestor within `.next/standalone`;
  - a parseable `public/manifest.json`.
- **`docker-release-tree`** (`/app`): the same Next files at the tree root, plus `server.js`, `package.json`, `node_modules/next` and a non-empty `migration.sql` in every migration directory.

**Startup smoke (R6):** `apps/web/scripts/check-artifact-startup.js` copies the artifact into an isolated temp directory with no `node_modules` above it. The artifact is the located standalone root plus `.next/static` and `public/`, or the Docker `/app` tree. It then starts the generated `server.js` with no database or secrets on 127.0.0.1, under a hook that aborts if any module resolves outside the copy. It requires the server to serve `/_next/static/<BUILD_ID>/_buildManifest.js` within the timeout, then terminates it. This catches missing transitive startup files (for example `require-hook.js`) without any list of Next file names. It runs in the CI web-build job and the Docker release-tree stage. Vercel deploys its own serverless output, not this server, so hosted runtime completeness is not claimed from it.

**Executable runtime (R5):** every package that `server.js` requires (Next 14: `next` and `next/dist/server/lib/start-server`) must resolve. Resolution searches only `node_modules` from the app root up to the artifact boundary, never the workspace or the host, and the resolved entry file must be non-empty, readable and inside the shipped artifact.

Missing, empty, unreadable, malformed or inconsistent required output fails closed. This is a structural check, not a file count.

It is unconditional. `test/palm03E1ReleaseGuards.test.ts` and the package `guard.test.mjs` (G1, G1b, G1c) cover it.
