/**
 * Life Weather Engine V1 -- public API.
 *
 * See ../README.md for what this engine does (a deterministic synthesis
 * layer composing already-computed natal Personal Themes, current
 * Vimshottari life period, and current Transit Activation context into a
 * structured "which personal themes are currently active, and which
 * independent systems are reinforcing them" result), what it does not do
 * (no daily guidance, no horoscope prose, no activity recommendations, no
 * Panchang/Muhurta, no Ashtakavarga), and the exact synthesis model (Model
 * D planet-to-theme projection, structural QUIET/ACTIVE/STRONGLY_ACTIVE
 * state, categorical Dasha contribution, per-pair Transit contribution).
 */
export { deriveLifeWeather } from './engine';
export { getThemesForPlanet, isRecognizedMappedPlanet } from './mapping';
export { deriveLifeWeatherState } from './state';
export { buildNatalContributor, buildMahadashaContributor, buildAntardashaContributor, buildTransitContributor } from './contributors';
export { assertValidLifeWeatherInput } from './validation';
export { dedupeEvidenceRefs } from './evidence';

export {
  LIFE_WEATHER_ENGINE_VERSION,
  LIFE_WEATHER_SYNTHESIS_VERSION,
  LIFE_WEATHER_NATAL_BASELINE_V1,
  LIFE_WEATHER_DASHA_THEME_ACTIVATION_V1,
  LIFE_WEATHER_TRANSIT_TARGET_THEME_ACTIVATION_V1,
  LIFE_WEATHER_STRUCTURAL_STATE_V1,
  LIFE_WEATHER_CROSS_SYSTEM_REINFORCEMENT_V1,
  LIFE_WEATHER_SUMMARY_V1,
} from './provenance';

export { REINFORCEMENT_SOURCE_ORDER } from './constants';

export type { LifeWeatherInput } from './types';
export { LifeWeatherValidationError } from './types';
