// AURA-PALM-03-E1 -- module exports (development-only, synthetic-only).
//
// R3: the READING interface is generateSyntheticReading() in ./reading.ts, which builds the I1 feature set from ONE
// synthetic input and composes from the pinned packaged library. This module exports no reading-generation function:
// only library validation, the text-free selection plan (planSelection, for fixtures and the C1 oracle comparison),
// and the descriptors. Every function able to emit a reading or a plan requires { synthetic: true }.
//
// Nothing in apps/ may import this package (enforced by tests and by the E1 production-build guard).

import { loadLibrary, lintCatalogue, isValidatedLibrary } from './library.mjs';
import { pinnedLibrary, PACKAGED_CATALOGUE, PACKAGED_SCHEMA } from './packaged.mjs';
import { planSelection, validateObservations } from './compose.mjs';
import { E1_ENGINE, E1Error, MODES, DEFAULT_MODE, IMPLEMENTED_CAPABILITIES, DOMAINS, RECORD_MANIFEST } from './identity.mjs';
import { DESCRIPTOR_CONTRACT, checkFingerBases, headSlope, upwardEndingZone, heartEndingZone, zoneOf } from './descriptors.mjs';
import { assertSupportedSchema, validateAgainstSchema } from './schema-validate.mjs';
import { gridStatus, toGrid, MAX_INTERPRETABLE } from './grid.mjs';

/** The packaged C1 rev. 4 library (validated once, deep-frozen). */
export const defaultLibrary = pinnedLibrary;

export {
  E1_ENGINE, E1Error, MODES, DEFAULT_MODE, IMPLEMENTED_CAPABILITIES, DOMAINS, RECORD_MANIFEST,
  loadLibrary, lintCatalogue, isValidatedLibrary, planSelection, validateObservations,
  DESCRIPTOR_CONTRACT, checkFingerBases, headSlope, upwardEndingZone, heartEndingZone, zoneOf,
  assertSupportedSchema, validateAgainstSchema, gridStatus, toGrid, MAX_INTERPRETABLE,
  PACKAGED_CATALOGUE, PACKAGED_SCHEMA,
};
