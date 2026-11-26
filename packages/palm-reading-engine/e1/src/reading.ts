/**
 * AURA-PALM-03-E1 -- the reading interface (R3; single construction path R4).
 * DEVELOPMENT ONLY. SYNTHETIC ONLY. Not imported by any app module; excluded from every release build.
 *
 *   generateSyntheticReading(input, { synthetic: true, mode })
 *
 * `input` is ONE synthetic PALM-03-I1 input (landmarks, image size, quality feedback, line traces, marks). The I1
 * feature set is built here from that input by the frozen I1 builder; E1 then re-derives the palm frame, finger bases,
 * traces, palm facing and interpreted ratios (with their status) from the same input and refuses any inconsistency
 * (construction.mjs), derives the observations, and composes from the pinned packaged C1 library only. There is
 * no catalogue, schema, feature-set, finger-base or observation override.
 *
 * Guarantee: the reading is internally consistent with the one supplied synthetic input. It does not prove that the
 * input came from a physical hand or a real image (later scanner / real-image validation milestone).
 */
import { buildPalmFeatureSet, type PalmFeatureSetInput } from '../../../../apps/web/lib/palm-analysis/features';

// The engine core is ESM (.mjs); Node >= 22.12 loads it through the CommonJS loader used for this TypeScript file.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const core = require('./engine-core.mjs');

export type ReadingMode = 'combined' | 'indian-only' | 'western-only';

// R4 (F6): the pipeline is claimed once, here, with the frozen I1 builder. It builds the feature set itself, from a
// snapshot of the caller's input; no feature set, observation, catalogue or schema can be supplied from outside.
const reader: (input: unknown, options: unknown) => unknown = core.claimSyntheticReader(buildPalmFeatureSet);

/** options: an own { synthetic: true } (exactly true; inherited or accessor declarations are refused) and an optional mode. */
export function generateSyntheticReading(input: PalmFeatureSetInput, options: { synthetic: true; mode?: ReadingMode }): unknown {
  return reader(input, options);
}

export const E1Error = core.E1Error;
export const E1_ENGINE = core.E1_ENGINE;
