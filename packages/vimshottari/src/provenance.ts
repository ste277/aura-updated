/**
 * Vimshottari Dasha Engine V1 -- provenance/versioning.
 *
 * Distinct version concepts, kept explicit and never conflated:
 *
 * VIMSHOTTARI_ENGINE_VERSION = 'VIMSHOTTARI_DASHA_V1'  (this engine's own version)
 * packages/personal-intelligence's own CONTRACT_VERSION  (consumed, not owned)
 */
export const VIMSHOTTARI_ENGINE_VERSION = 'VIMSHOTTARI_DASHA_V1' as const;

/** Shared rule-version string for every evidence entry this engine emits. */
export const VIMSHOTTARI_RULE_VERSION = '1.0.0';

export const VIMSHOTTARI_NAKSHATRA_FROM_MOON_V1 = 'VIMSHOTTARI_NAKSHATRA_FROM_MOON_V1';
export const VIMSHOTTARI_STARTING_LORD_V1 = 'VIMSHOTTARI_STARTING_LORD_V1';
export const VIMSHOTTARI_BIRTH_BALANCE_V1 = 'VIMSHOTTARI_BIRTH_BALANCE_V1';
export const VIMSHOTTARI_MAHADASHA_DURATION_V1 = 'VIMSHOTTARI_MAHADASHA_DURATION_V1';
export const VIMSHOTTARI_ANTARDASHA_DURATION_V1 = 'VIMSHOTTARI_ANTARDASHA_DURATION_V1';
export const VIMSHOTTARI_YEAR_LENGTH_365_25_V1 = 'VIMSHOTTARI_YEAR_LENGTH_365_25_V1';
export const VIMSHOTTARI_INTERVAL_BOUNDARY_V1 = 'VIMSHOTTARI_INTERVAL_BOUNDARY_V1';
