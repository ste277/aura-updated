// AURA-PALM-03-E1-R3 -- internal pipeline used by reading.ts: one synthetic input + the I1 feature set built from it
// -> verified construction -> minted observations -> reading from the pinned library. Requires { synthetic: true }.
// Not a supported interface on its own: callers use generateSyntheticReading() in reading.ts.
import { pinnedLibrary } from './packaged.mjs';
import { deriveObservations } from './observations.mjs';
import { composeReading } from './compose.mjs';
import { E1Error, E1_ENGINE, MODES } from './identity.mjs';

export function readingFromConstruction(input, featureSet, options) {
  if (options === null || typeof options !== 'object' || options.synthetic !== true) throw new E1Error('synthetic-required', 'pass { synthetic: true }; real input is not authorised');
  const mode = options.mode ?? 'combined';
  if (!MODES.includes(mode)) throw new E1Error('invalid-option', `mode must be one of ${MODES.join(', ')}`);
  const minted = deriveObservations(pinnedLibrary(), input, featureSet, { synthetic: true });
  return composeReading(minted, { synthetic: true, mode });
}

export { E1Error, E1_ENGINE };
