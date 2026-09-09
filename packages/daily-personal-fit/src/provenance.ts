/**
 * Daily Personal Fit Engine V1 -- provenance/versioning.
 *
 * Two distinct version concepts, kept separate (matching every prior
 * engine's own precedent in this roadmap):
 * - DAILY_PERSONAL_FIT_ENGINE_VERSION: this engine's own version, stamped
 *   on every DailyPersonalFitContext.engineVersion.
 * - ACTIVITY_THEME_MAPPING_VERSION: the version of the activity-family ->
 *   PersonalTheme[] mapping table (mapping.ts) this engine currently
 *   applies -- kept as its own constant, independent of the engine
 *   version, so a future revision of the mapping table alone (e.g.
 *   splitting a family, adding a theme) could be introduced without
 *   necessarily bumping the engine version itself.
 *
 * Every rule id below is this engine's OWN synthesis fact -- never a
 * traditional astrology calculation and never copied verbatim from an
 * upstream engine's own evidence. See README.md's "Traditional vs Aura"
 * section for the full boundary these rule ids exist to keep visible.
 */
export const DAILY_PERSONAL_FIT_ENGINE_VERSION = 'DAILY_PERSONAL_FIT_V1' as const;
export const ACTIVITY_THEME_MAPPING_VERSION = 'ACTIVITY_THEME_MAPPING_V1';

/** One activity family's own relevance derivation (which mapped themes were inspected, which maximum state determined the result). */
export const DAILY_PERSONAL_FIT_RELEVANCE_DERIVATION_V1 = 'DAILY_PERSONAL_FIT_RELEVANCE_DERIVATION_V1';
/** One top-level summary evidence entry per result -- evaluation time, activity-family count, relevant/highly-relevant counts (mirrors every prior engine's own summary-evidence precedent, e.g. Life Weather's own LIFE_WEATHER_SUMMARY_V1). */
export const DAILY_PERSONAL_FIT_SUMMARY_V1 = 'DAILY_PERSONAL_FIT_SUMMARY_V1';
