/**
 * Vimshottari Dasha Engine V1 -- public API.
 *
 * See ../README.md for what this engine does (deterministically
 * calculates Vimshottari Mahadasha/Antardasha periods from an
 * already-known natal Moon longitude), what V1 does not do (no
 * Pratyantardasha, no transits, no Ashtakavarga, no daily guidance), and
 * the exact convention (27 Nakshatras, 120-year cycle, 365.25-day year,
 * [start, end) boundaries).
 */
export {
  calculateVimshottariDasha,
  calculateVimshottariFromNatalChart,
  findMahadashaAt,
  findAntardashaAt,
  getVimshottariPeriodAt,
  toLifePeriodContext,
} from './engine';

export { calculateBirthBalance, generateMahadashaCycle } from './mahadasha';
export { generateAntardashas } from './antardasha';
export { mahadashaDurationMs, antardashaDurationMs, toIsoInstant, fromIsoInstant } from './duration';
export { normalizeLongitude, nakshatraIndexFromLongitude, nakshatraName, nakshatraLord, nakshatraOffset } from './nakshatra';
export { dedupeEvidenceRefs } from './evidence';

export {
  VIMSHOTTARI_ENGINE_VERSION,
  VIMSHOTTARI_RULE_VERSION,
  VIMSHOTTARI_NAKSHATRA_FROM_MOON_V1,
  VIMSHOTTARI_STARTING_LORD_V1,
  VIMSHOTTARI_BIRTH_BALANCE_V1,
  VIMSHOTTARI_MAHADASHA_DURATION_V1,
  VIMSHOTTARI_ANTARDASHA_DURATION_V1,
  VIMSHOTTARI_YEAR_LENGTH_365_25_V1,
  VIMSHOTTARI_INTERVAL_BOUNDARY_V1,
} from './provenance';

export {
  VIMSHOTTARI_YEAR_DAYS,
  VIMSHOTTARI_YEAR_MS,
  VIMSHOTTARI_ANTARDASHA_UNIT_MS,
  VIMSHOTTARI_SEQUENCE,
  VIMSHOTTARI_YEARS,
  NAKSHATRA_SPAN_DEGREES,
  NAKSHATRA_COUNT,
  MAHADASHA_COUNT_PER_CYCLE,
  ANTARDASHA_COUNT_PER_MAHADASHA,
  VIMSHOTTARI_MIN_COVERAGE_YEARS,
  VIMSHOTTARI_MIN_COVERAGE_MS,
} from './constants';

export type {
  VimshottariLord,
  VimshottariPeriod,
  VimshottariMahadashaPeriod,
  VimshottariBirthNakshatra,
  VimshottariDashaResult,
  VimshottariDashaInput,
} from './types';
export { VimshottariValidationError } from './types';
