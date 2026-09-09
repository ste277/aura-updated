/**
 * Personal Themes Engine V1 -- Bhrigu karaka -> Personal Theme mapping.
 *
 * Hand-authored, versioned V1 product interpretation configuration --
 * never derived from string similarity at runtime. This is Aura's own
 * product-level interpretation of packages/bhrigu's existing karaka
 * data (PLANET_KARAKAS, packages/bhrigu/src/karakas.ts); it does not
 * claim classical texts directly define these ten specific product
 * themes -- see README.md's disclaimer.
 *
 * Every entry uses weight 1.0 (kept for eligibility/provenance record-
 * keeping only -- see scoring.ts's own module doc comment: this table
 * establishes WHICH planets are eligible to support each Personal
 * Theme and carries the mapping's own evidence, but a mapping entry's
 * `weight` no longer contributes any numeric score. Every real Bhrigu
 * chart has the exact same 9 planets, so "Mercury exists and maps to
 * FINANCE" is true for every chart and carries zero personalizing
 * information on its own; only chart-specific relationship/chain
 * REINFORCEMENT between eligible planets varies by user and drives the
 * actual numeric strength). The 4 karaka strings per planet below are
 * copied verbatim from PLANET_KARAKAS (packages/bhrigu/src/karakas.ts)
 * -- every one of the 36 (9 planets x 4 karakas) entries there has
 * exactly one row here.
 */
import { PERSONAL_THEMES_RULE_VERSION, mappingRuleId } from './provenance';
import { SUPPORTED_PLANETS } from '../../bhrigu/src/constants';
import type { ThemeMappingRule } from './types';

function rule(planet: ThemeMappingRule['planet'], karaka: string, theme: ThemeMappingRule['theme']): ThemeMappingRule {
  return {
    planet,
    karaka,
    theme,
    weight: 1.0,
    ruleId: mappingRuleId(planet, karaka, theme),
    ruleVersion: PERSONAL_THEMES_RULE_VERSION,
  };
}

/**
 * The complete V1 mapping table, 36 entries (9 planets x 4 karakas each),
 * in a fixed planet-then-karaka order matching PLANET_KARAKAS's own
 * ordering. mappings.ts's own helpers (getMappingRulesForPlanetKaraka,
 * getDistinctSupportingPlanets, distinctSupportingPlanetCount) are the
 * only intended way to query this table -- iteration order elsewhere
 * always goes through
 * packages/personal-intelligence's own PERSONAL_THEMES canonical order,
 * never this array's own order.
 */
export const THEME_MAPPING_RULES: readonly ThemeMappingRule[] = [
  // Sun -- identity, authority, leadership, vitality
  rule('Sun', 'identity', 'CAREER'),
  rule('Sun', 'authority', 'CAREER'),
  rule('Sun', 'leadership', 'CAREER'),
  rule('Sun', 'vitality', 'WELLBEING'),
  // Moon -- mind, emotion, habits, nourishment
  rule('Moon', 'mind', 'FOCUS'),
  rule('Moon', 'emotion', 'RELATIONSHIPS'),
  rule('Moon', 'habits', 'WELLBEING'),
  rule('Moon', 'nourishment', 'WELLBEING'),
  // Mercury -- communication, learning, analysis, commerce
  rule('Mercury', 'communication', 'SOCIAL'),
  rule('Mercury', 'learning', 'LEARNING'),
  rule('Mercury', 'analysis', 'FOCUS'),
  rule('Mercury', 'commerce', 'FINANCE'),
  // Venus -- relationships, aesthetics, pleasure, harmony
  rule('Venus', 'relationships', 'RELATIONSHIPS'),
  rule('Venus', 'aesthetics', 'CREATIVITY'),
  rule('Venus', 'pleasure', 'WELLBEING'),
  rule('Venus', 'harmony', 'RELATIONSHIPS'),
  // Mars -- action, drive, competition, courage
  rule('Mars', 'action', 'FOCUS'),
  rule('Mars', 'drive', 'CAREER'),
  rule('Mars', 'competition', 'CAREER'),
  rule('Mars', 'courage', 'EXPLORATION'),
  // Jupiter -- knowledge, growth, wisdom, expansion
  rule('Jupiter', 'knowledge', 'LEARNING'),
  rule('Jupiter', 'growth', 'CAREER'),
  rule('Jupiter', 'wisdom', 'SPIRITUALITY'),
  rule('Jupiter', 'expansion', 'EXPLORATION'),
  // Saturn -- discipline, responsibility, delay, endurance
  rule('Saturn', 'discipline', 'FOCUS'),
  rule('Saturn', 'responsibility', 'CAREER'),
  rule('Saturn', 'delay', 'FOCUS'),
  rule('Saturn', 'endurance', 'WELLBEING'),
  // Rahu -- amplification, novelty, ambition, unconventionality
  rule('Rahu', 'amplification', 'CAREER'),
  rule('Rahu', 'novelty', 'EXPLORATION'),
  rule('Rahu', 'ambition', 'CAREER'),
  rule('Rahu', 'unconventionality', 'CREATIVITY'),
  // Ketu -- detachment, reduction, introspection, separation
  rule('Ketu', 'detachment', 'SPIRITUALITY'),
  rule('Ketu', 'reduction', 'FOCUS'),
  rule('Ketu', 'introspection', 'SPIRITUALITY'),
  rule('Ketu', 'separation', 'RELATIONSHIPS'),
];

/** All V1 mapping rules for one planet's specific karaka string (0 or more -- 0 for a karaka string this table doesn't recognize, e.g. a future Bhrigu karaka revision). */
export function getMappingRulesForPlanetKaraka(planet: ThemeMappingRule['planet'], karaka: string): ThemeMappingRule[] {
  return THEME_MAPPING_RULES.filter((entry) => entry.planet === planet && entry.karaka === karaka);
}

/** All V1 mapping rules whose target is the given theme. */
export function getMappingRulesForTheme(theme: ThemeMappingRule['theme']): ThemeMappingRule[] {
  return THEME_MAPPING_RULES.filter((entry) => entry.theme === theme);
}

/**
 * The distinct planets whose karakas map to the given theme, in
 * SUPPORTED_PLANETS' own fixed canonical order -- deduplicated by planet,
 * NOT by mapping rule. Several planets map more than one of their own
 * karakas to the same theme (e.g. Saturn's `discipline` AND `delay` both
 * map to FOCUS); for reinforcement-ceiling purposes that planet counts
 * ONCE, not twice -- every real Bhrigu chart always has exactly the same
 * 9 planets present (packages/bhrigu/src/graph.ts always builds all 9
 * nodes, unconditionally), so double-counting a planet's own duplicate
 * karaka mappings would inflate the ceiling for no chart-specific reason.
 */
export function getDistinctSupportingPlanets(theme: ThemeMappingRule['theme']): ThemeMappingRule['planet'][] {
  const planets = new Set<ThemeMappingRule['planet']>();
  for (const rule of getMappingRulesForTheme(theme)) planets.add(rule.planet);
  return SUPPORTED_PLANETS.filter((planet) => planets.has(planet));
}

/**
 * A theme's fixed, chart-INDEPENDENT count of distinct supporting
 * planets ("n" in scoring.ts's own deriveThemeReinforcementCeiling) --
 * derived purely from the static, versioned mapping table above, never
 * from any specific user's chart. Every real chart has the same 9
 * planets present, so which planets are ELIGIBLE to support a theme is a
 * constant; only whether those eligible planets are actually
 * chart-specifically RELATED (relationship/chain reinforcement) varies
 * by user -- see scoring.ts's own module doc comment for the full
 * reasoning behind the reinforcement-only scoring model this feeds.
 */
export function distinctSupportingPlanetCount(theme: ThemeMappingRule['theme']): number {
  return getDistinctSupportingPlanets(theme).length;
}
