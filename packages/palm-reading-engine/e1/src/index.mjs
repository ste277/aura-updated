// AURA-PALM-03-E1 -- public entry points (development-only, synthetic-only).
//
//   generateE1Reading(input, { synthetic: true, mode })   I1 feature set + palm-frame finger bases -> structured reading
//   composeFromObservations(observations, { mode, qualityAccepted })  abstract observations -> reading (used by tests
//                                                         against the C1 reference oracle)
//   loadLibrary(catalogue, schema), lintCatalogue(...)    library validation
//
// Nothing in apps/ may import this package (enforced by tests and by the E1 production-build guard).

import catalogue from '../library/catalogue.json' with { type: 'json' };
import schema from '../library/schema.json' with { type: 'json' };
import { loadLibrary, lintCatalogue } from './library.mjs';
import { deriveObservations } from './observations.mjs';
import { composeReading, validateObservations } from './compose.mjs';
import { E1_ENGINE, E1Error, MODES, DEFAULT_MODE, IMPLEMENTED_CAPABILITIES, DOMAINS } from './identity.mjs';
import { DESCRIPTOR_CONTRACT, checkFingerBases, headSlope, upwardEndingZone, heartEndingZone, zoneOf } from './descriptors.mjs';
import { assertSupportedSchema, validateAgainstSchema } from './schema-validate.mjs';

let cached = null;
/** The packaged C1 rev. 4 library, validated once. */
export function defaultLibrary() {
  if (!cached) cached = loadLibrary(catalogue, schema);
  return cached;
}

export function generateE1Reading(input, options) {
  const lib = options?.library ?? defaultLibrary();
  const { observations, qualityAccepted, qualityDetail } = deriveObservations(lib, input, options);
  return composeReading(lib, observations, { mode: options.mode ?? DEFAULT_MODE, qualityAccepted, qualityDetail });
}

export function composeFromObservations(observations, options = {}) {
  const lib = options.library ?? defaultLibrary();
  return composeReading(lib, observations, { mode: options.mode ?? DEFAULT_MODE, qualityAccepted: options.qualityAccepted ?? true, qualityDetail: options.qualityDetail });
}

export {
  E1_ENGINE, E1Error, MODES, DEFAULT_MODE, IMPLEMENTED_CAPABILITIES, DOMAINS,
  loadLibrary, lintCatalogue, deriveObservations, composeReading, validateObservations,
  DESCRIPTOR_CONTRACT, checkFingerBases, headSlope, upwardEndingZone, heartEndingZone, zoneOf,
  assertSupportedSchema, validateAgainstSchema,
  catalogue as PACKAGED_CATALOGUE, schema as PACKAGED_SCHEMA,
};
