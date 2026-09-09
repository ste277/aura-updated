/**
 * Life Weather Engine V1 -- provenance/versioning.
 *
 * Two distinct version concepts, kept separate (matching every prior
 * engine's own precedent in this roadmap):
 * - LIFE_WEATHER_ENGINE_VERSION: this engine's own version, stamped on
 *   every LifeWeatherContext.engineVersion.
 * - LIFE_WEATHER_SYNTHESIS_VERSION: the version of the SYNTHESIS rules
 *   this engine applies (the state-derivation model, the planet-to-theme
 *   projection convention) -- kept as its own constant so a future
 *   revision of the synthesis model (e.g. a different state-threshold
 *   rule) could be introduced as a new rule version without necessarily
 *   bumping the engine version itself.
 *
 * Every rule id below is Life Weather's OWN synthesis fact -- never a
 * traditional astrology calculation (that provenance already lives in
 * Vimshottari's/Transit Activation's own evidence, sourced
 * 'VIMSHOTTARI_DASHA'/'TRANSIT_ACTIVATION') and never copied verbatim
 * from either. See README.md's "Traditional vs Aura" section for the
 * full boundary these rule ids exist to keep visible.
 */
export const LIFE_WEATHER_ENGINE_VERSION = 'LIFE_WEATHER_V1' as const;
export const LIFE_WEATHER_SYNTHESIS_VERSION = 'LIFE_WEATHER_SYNTHESIS_V1';

/** A theme's own immutable natal baseline was carried through unmodified. */
export const LIFE_WEATHER_NATAL_BASELINE_V1 = 'LIFE_WEATHER_NATAL_BASELINE_V1';
/** A Mahadasha/Antardasha lord's own themes (via the canonical Personal Themes mapping) are currently activated -- categorical, no numeric weighting. */
export const LIFE_WEATHER_DASHA_THEME_ACTIVATION_V1 = 'LIFE_WEATHER_DASHA_THEME_ACTIVATION_V1';
/** A transit's own natal target's themes (via the canonical Personal Themes mapping, Model D -- never the transiting planet's own themes) are currently activated. */
export const LIFE_WEATHER_TRANSIT_TARGET_THEME_ACTIVATION_V1 = 'LIFE_WEATHER_TRANSIT_TARGET_THEME_ACTIVATION_V1';
/** The structural QUIET/ACTIVE/STRONGLY_ACTIVE derivation for one theme. */
export const LIFE_WEATHER_STRUCTURAL_STATE_V1 = 'LIFE_WEATHER_STRUCTURAL_STATE_V1';
/** Both DASHA and TRANSIT independently reinforce the same theme (the STRONGLY_ACTIVE case specifically). */
export const LIFE_WEATHER_CROSS_SYSTEM_REINFORCEMENT_V1 = 'LIFE_WEATHER_CROSS_SYSTEM_REINFORCEMENT_V1';
/** One top-level summary evidence entry per result -- evaluation time, theme count, active/strongly-active counts (mirrors every prior engine's own summary-evidence precedent, e.g. Transit Activation's TRANSIT_ACTIVATION_SUMMARY_V1). */
export const LIFE_WEATHER_SUMMARY_V1 = 'LIFE_WEATHER_SUMMARY_V1';
