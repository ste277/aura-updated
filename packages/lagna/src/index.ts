/**
 * Natal Ascendant / Lagna Foundation V1 -- public API.
 *
 * See ../README.md for what this engine does (deterministically
 * calculates the tropical and Lahiri sidereal Ascendant/Lagna for a
 * birth moment + geographic coordinates), what it does not do (no house
 * system, no Ashtakavarga, no product interpretation), and the exact
 * convention (true ecliptic of date, Lahiri ayanamsa, [0,360)
 * normalization, 0-11 Rashi indexing).
 */
export { calculateNatalAscendant, calculateNatalAscendantFromInput } from './engine';
export { findTropicalAscendantLongitude } from './ascendant';
export { normalize360, toRashiPlacement } from './sign';
export { makeEclipticHorizonProbe } from './rotation';

export {
  NATAL_LAGNA_ENGINE_VERSION,
  NATAL_LAGNA_RULE_VERSION,
  NATAL_LAGNA_LOCAL_SIDEREAL_TIME_V1,
  NATAL_LAGNA_TROPICAL_ASCENDANT_V1,
  NATAL_LAGNA_LAHIRI_CONVERSION_V1,
  NATAL_LAGNA_RASHI_V1,
} from './provenance';

export {
  RASHI_SPAN_DEGREES,
  RASHI_COUNT,
  RASHI_NAMES,
  ASCENDANT_SCAN_SAMPLES,
  ASCENDANT_BISECTION_ITERATIONS,
  MIN_VALID_LATITUDE,
  MAX_VALID_LATITUDE,
  MIN_VALID_LONGITUDE,
  MAX_VALID_LONGITUDE,
} from './constants';

export type { NatalAscendant, NatalAscendantInput, NatalLagnaEvidenceRef } from './types';
export { NatalLagnaValidationError, NatalLagnaComputationError } from './types';
