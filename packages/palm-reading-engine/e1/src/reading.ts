/**
 * AURA-PALM-03-E1 -- the reading interface (R3).
 * DEVELOPMENT ONLY. SYNTHETIC ONLY. Not imported by any app module; excluded from every release build.
 *
 *   generateSyntheticReading(input, { synthetic: true, mode })
 *
 * `input` is ONE synthetic PALM-03-I1 input (landmarks, image size, quality feedback, line traces, marks). The I1
 * feature set is built here from that input by the frozen I1 builder; E1 then re-derives the palm frame, finger bases,
 * traces and interpreted ratios from the same input and refuses any inconsistency (construction.mjs), derives the
 * observations, and composes from the pinned packaged C1 library only. There is no catalogue, schema, feature-set,
 * finger-base or observation override.
 *
 * Guarantee: the reading is internally consistent with the one supplied synthetic input. It does not prove that the
 * input came from a physical hand or a real image (later scanner / real-image validation milestone).
 */
import { buildPalmFeatureSet, type PalmFeatureSetInput } from '../../../../apps/web/lib/palm-analysis/features';

// The engine core is ESM (.mjs); Node >= 22.12 loads it through the CommonJS loader used for this TypeScript file.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const core = require('./engine-core.mjs');

export type ReadingMode = 'combined' | 'indian-only' | 'western-only';

export function generateSyntheticReading(input: PalmFeatureSetInput, options: { synthetic: true; mode?: ReadingMode }): unknown {
  if (options === null || typeof options !== 'object' || (options as { synthetic?: unknown }).synthetic !== true) {
    throw new core.E1Error('synthetic-required', 'pass { synthetic: true }; real input is not authorised');
  }
  const extra = Object.keys(options).filter((k) => k !== 'synthetic' && k !== 'mode');
  if (extra.length) throw new core.E1Error('invalid-option', `unsupported options: ${extra.join(', ')} (no catalogue, schema or observation overrides)`);
  let built;
  try {
    built = buildPalmFeatureSet(input);
  } catch (err) {
    throw new core.E1Error('invalid-input', `the I1 builder refused the input: ${String((err as Error)?.message ?? err)}`);
  }
  if (!built.ok) throw new core.E1Error('invalid-input', `the I1 builder refused the input: ${built.errors.join('; ')}`);
  return core.readingFromConstruction(input, built.featureSet, { synthetic: true, mode: options.mode ?? 'combined' });
}

export const E1Error = core.E1Error;
export const E1_ENGINE = core.E1_ENGINE;
