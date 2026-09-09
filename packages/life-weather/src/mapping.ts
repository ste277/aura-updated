/**
 * Life Weather Engine V1 -- canonical planet -> theme eligibility.
 *
 * Reuses packages/personal-themes's own existing, public, versioned
 * `THEME_MAPPING_RULES` (planet + karaka -> PersonalTheme, 36 hand-authored
 * entries) -- this file does NOT define a second planet-to-theme table.
 * `getThemesForPlanet` is a thin filter over that canonical table, deriving
 * a plain planet -> PersonalTheme[] view it does not already expose as a
 * named export. Every mapping rule's own `weight` (always 1.0) is never
 * read here -- eligibility is categorical (a planet either maps to a theme
 * or it doesn't), never a numeric contribution (see README.md's "Dasha and
 * transit contribution are categorical" section).
 */
import { THEME_MAPPING_RULES } from '../../personal-themes/src/mappings';
import { PERSONAL_THEMES } from '../../personal-intelligence/src/themes';
import type { PersonalTheme } from '../../personal-intelligence/src/types';

/**
 * The distinct PersonalTheme values `planet`'s own karakas map to, in
 * PERSONAL_THEMES canonical order (deduplicated -- several karakas of the
 * same planet can map to the same theme, e.g. Saturn's `discipline` AND
 * `delay` both map to FOCUS; that counts once here). Returns `[]` for a
 * planet string the canonical table doesn't recognize (never throws --
 * see validation.ts for where an unrecognized planet name is actually
 * rejected as malformed input).
 */
export function getThemesForPlanet(planet: string): PersonalTheme[] {
  const themes = new Set<PersonalTheme>();
  for (const rule of THEME_MAPPING_RULES) {
    if (rule.planet === planet) themes.add(rule.theme);
  }
  return PERSONAL_THEMES.filter((theme) => themes.has(theme));
}

/** True only for a planet name the canonical Personal Themes mapping table recognizes (i.e. `getThemesForPlanet` would return at least one theme). */
export function isRecognizedMappedPlanet(planet: string): boolean {
  return getThemesForPlanet(planet).length > 0;
}
