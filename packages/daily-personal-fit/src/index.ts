/**
 * Daily Personal Fit Engine V1 -- public API.
 *
 * See ../README.md for what this engine does (a deterministic projection
 * of an already-computed LifeWeatherContext onto Aura's canonical
 * Muhurta activity-family vocabulary, producing a structural
 * personal-relevance vector), what it does not do (no Panchang, no
 * Muhurta evaluation, no Aura Fit evaluation, no timing windows, no
 * ranking, no natural-language guidance -- see the "Hard boundary
 * (Option B)" section), and the exact relevance model (structural
 * maximum of mapped themes' own LifeWeatherState, never natalStrength,
 * never natalDirection, never a count/sum).
 */
export { deriveDailyPersonalFit } from './engine';
export { getThemesForActivityFamily, isMappingComplete, ACTIVITY_THEME_MAPPING } from './mapping';
export { deriveActivityRelevance } from './relevance';
export { buildRelevanceEvidence, buildSummaryEvidence, dedupeEvidenceRefs } from './evidence';
export { assertValidDailyPersonalFitInput } from './validation';

export {
  DAILY_PERSONAL_FIT_ENGINE_VERSION,
  ACTIVITY_THEME_MAPPING_VERSION,
  DAILY_PERSONAL_FIT_RELEVANCE_DERIVATION_V1,
  DAILY_PERSONAL_FIT_SUMMARY_V1,
} from './provenance';

export { CANONICAL_ACTIVITY_FAMILIES, CANONICAL_ACTIVITY_FAMILY_COUNT } from './constants';

export type { DailyPersonalFitInput } from './types';
export { DailyPersonalFitValidationError } from './types';
