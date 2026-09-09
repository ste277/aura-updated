/**
 * Bhrigu Natal Foundation V1 -- planet karakas (traditional significations).
 *
 * These theme lists are versioned interpretive metadata carried through
 * this engine as data, not asserted as scientific or empirical fact --
 * see README.md's disclaimer. Each entry is independently versioned
 * (sourceRuleId + version) so a future theme-list revision can be
 * introduced as a new rule id without silently mutating V1's own output
 * for existing callers.
 */
import { RULE_VERSION_V1 } from './constants';
import type { PlanetId, PlanetKarakaDefinition } from './types';

const KARAKA_VERSION = RULE_VERSION_V1;

/** Keep this list ordered exactly as constants.ts's SUPPORTED_PLANETS for readability; iteration order elsewhere always goes through SUPPORTED_PLANETS, never this object's own key order. */
export const PLANET_KARAKAS: Record<PlanetId, PlanetKarakaDefinition> = {
  Sun: {
    planet: 'Sun',
    themes: ['identity', 'authority', 'leadership', 'vitality'],
    sourceRuleId: 'BHRIGU_KARAKA_SUN_V1',
    version: KARAKA_VERSION,
  },
  Moon: {
    planet: 'Moon',
    themes: ['mind', 'emotion', 'habits', 'nourishment'],
    sourceRuleId: 'BHRIGU_KARAKA_MOON_V1',
    version: KARAKA_VERSION,
  },
  Mercury: {
    planet: 'Mercury',
    themes: ['communication', 'learning', 'analysis', 'commerce'],
    sourceRuleId: 'BHRIGU_KARAKA_MERCURY_V1',
    version: KARAKA_VERSION,
  },
  Venus: {
    planet: 'Venus',
    themes: ['relationships', 'aesthetics', 'pleasure', 'harmony'],
    sourceRuleId: 'BHRIGU_KARAKA_VENUS_V1',
    version: KARAKA_VERSION,
  },
  Mars: {
    planet: 'Mars',
    themes: ['action', 'drive', 'competition', 'courage'],
    sourceRuleId: 'BHRIGU_KARAKA_MARS_V1',
    version: KARAKA_VERSION,
  },
  Jupiter: {
    planet: 'Jupiter',
    themes: ['knowledge', 'growth', 'wisdom', 'expansion'],
    sourceRuleId: 'BHRIGU_KARAKA_JUPITER_V1',
    version: KARAKA_VERSION,
  },
  Saturn: {
    planet: 'Saturn',
    themes: ['discipline', 'responsibility', 'delay', 'endurance'],
    sourceRuleId: 'BHRIGU_KARAKA_SATURN_V1',
    version: KARAKA_VERSION,
  },
  Rahu: {
    planet: 'Rahu',
    themes: ['amplification', 'novelty', 'ambition', 'unconventionality'],
    sourceRuleId: 'BHRIGU_KARAKA_RAHU_V1',
    version: KARAKA_VERSION,
  },
  Ketu: {
    planet: 'Ketu',
    themes: ['detachment', 'reduction', 'introspection', 'separation'],
    sourceRuleId: 'BHRIGU_KARAKA_KETU_V1',
    version: KARAKA_VERSION,
  },
};

export function getKarakaDefinition(planet: PlanetId): PlanetKarakaDefinition {
  return PLANET_KARAKAS[planet];
}

export function getKarakaThemes(planet: PlanetId): string[] {
  return PLANET_KARAKAS[planet].themes;
}
