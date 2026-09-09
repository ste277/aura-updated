/**
 * Ashtakavarga Engine V1 -- public API.
 *
 * See ../README.md for what this engine does (deterministically
 * calculates the seven classical Bhinna Ashtakavarga tables and the raw
 * Sarvashtakavarga from already-known sidereal Rashi placements), what
 * it does not do (no Trikona/Ekadhipatya Shodhana, no Shodhya Pinda, no
 * transit interpretation, no product scoring), and the exact convention
 * (standard Parashara 56-rule table, 8 contributors excluding Rahu/Ketu,
 * 1-12 inclusive relative-house counting, raw fixed totals
 * 48/49/39/54/56/52/39/337).
 */
export { calculateAshtakavarga, calculateAshtakavargaFromNatalChart } from './engine';
export { calculateSignResult } from './prastara';
export { calculateBhinnaAshtakavarga } from './bhinna';
export { calculateSarvashtakavarga } from './sarva';
export { relativeHouse } from './relativeHouse';
export { ASHTAKAVARGA_RULES, findRule } from './rules';
export { dedupeEvidenceRefs } from './evidence';

export {
  ASHTAKAVARGA_ENGINE_VERSION,
  ASHTAKAVARGA_RULESET_VERSION,
  ASHTAKAVARGA_RULE_VERSION,
  ASHTAKAVARGA_BAV_SIGN_SUM_V1,
  ASHTAKAVARGA_BAV_TOTAL_V1,
  ASHTAKAVARGA_SAV_SIGN_SUM_V1,
  ASHTAKAVARGA_SAV_TOTAL_V1,
} from './provenance';

export {
  ASHTAKAVARGA_TARGETS,
  ASHTAKAVARGA_CONTRIBUTORS,
  ASHTAKAVARGA_TARGET_COUNT,
  ASHTAKAVARGA_CONTRIBUTOR_COUNT,
  ZODIAC_SIGN_COUNT,
  ASHTAKAVARGA_FIXED_TOTALS,
  ASHTAKAVARGA_SAV_FIXED_TOTAL,
} from './constants';

export type {
  ZodiacSign,
  RelativeHouse,
  AshtakavargaPoint,
  AshtakavargaTargetPlanet,
  AshtakavargaContributor,
  AshtakavargaContributionRule,
  AshtakavargaContribution,
  AshtakavargaSignResult,
  BhinnaAshtakavarga,
  SarvashtakavargaSignResult,
  Sarvashtakavarga,
  AshtakavargaNatalInput,
  AshtakavargaResult,
  AshtakavargaEvidenceRef,
} from './types';
export { AshtakavargaValidationError } from './types';
export type { AshtakavargaContributorSigns } from './prastara';
