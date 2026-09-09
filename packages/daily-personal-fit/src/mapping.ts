/**
 * Daily Personal Fit Engine V1 -- canonical activity family -> Personal
 * Theme mapping.
 *
 * This is a NEW Aura product-semantic mapping -- no existing table
 * anywhere in the repo already maps packages/muhurta's own
 * MuhurtaActivityFamily onto packages/personal-intelligence's own
 * PersonalTheme (confirmed by repo-wide search across
 * packages/recommendation, packages/muhurta, packages/personal-themes,
 * and apps/web during this PR's own architecture audit). This table is
 * therefore hand-authored here, once, versioned as
 * ACTIVITY_THEME_MAPPING_V1 (provenance.ts) -- NOT a classical astrology
 * rule, NOT weighted, NOT traditional doctrine. See README.md's
 * "Traditional vs Aura" section.
 *
 * Direction is deliberately ActivityFamily -> PersonalTheme[] (not the
 * reverse, and not a bidirectional table) -- matching exactly the shape
 * the engine's own per-activity query needs ("which themes are relevant
 * to THIS activity family"), and the identical precedent
 * packages/life-weather/src/mapping.ts's own getThemesForPlanet already
 * established for an analogous lookup.
 *
 * CREATIVITY maps only from DEEP_WORK/NEW_BEGINNING and SPIRITUALITY only
 * from MEDITATION -- deliberate: the current SCORED Muhurta taxonomy
 * (MuhurtaActivityFamily, 13 values) has no dedicated creative or
 * spiritual-beyond-meditation family, and this PR does not extend that
 * taxonomy (out of scope -- #102 maps onto EXISTING scoring vocabulary
 * only, never invents a new Muhurta family).
 */
import { CANONICAL_ACTIVITY_FAMILIES } from './constants';
import type { MuhurtaActivityFamily } from '../../muhurta/src/muhurtaEngine';
import type { PersonalTheme } from '../../personal-intelligence/src/types';

/** Every one of the 13 canonical MuhurtaActivityFamily values has exactly one entry -- see test/dailyPersonalFitEngine.test.ts's own mapping-completeness check for the 13/13 invariant this table must never silently violate. */
export const ACTIVITY_THEME_MAPPING: Record<MuhurtaActivityFamily, readonly PersonalTheme[]> = {
  DEEP_WORK: ['FOCUS', 'CAREER', 'LEARNING', 'CREATIVITY'],
  WORKOUT: ['WELLBEING'],
  LEARNING: ['LEARNING', 'FOCUS'],
  MEDITATION: ['SPIRITUALITY', 'WELLBEING'],
  RELATIONSHIP: ['RELATIONSHIPS'],
  JOURNEY_START: ['EXPLORATION'],
  SOCIAL: ['SOCIAL', 'RELATIONSHIPS'],
  MEAL: ['WELLBEING'],
  FINANCE: ['FINANCE'],
  NEW_BEGINNING: ['CAREER', 'CREATIVITY', 'EXPLORATION'],
  ADMIN: ['FOCUS', 'CAREER'],
  WELLBEING: ['WELLBEING'],
  FOCUSED_WORK: ['FOCUS', 'CAREER'],
};

/** The PersonalTheme[] mapped to `family` -- always a non-empty array for every canonical family (see mapping-completeness invariant above). */
export function getThemesForActivityFamily(family: MuhurtaActivityFamily): readonly PersonalTheme[] {
  return ACTIVITY_THEME_MAPPING[family];
}

/** True only if every canonical activity family (constants.ts) has a mapping-table entry with at least one mapped theme -- the 13/13 completeness invariant, checked at module load via assertMappingIsComplete below rather than only in tests. */
export function isMappingComplete(): boolean {
  return CANONICAL_ACTIVITY_FAMILIES.every((family) => {
    const themes = ACTIVITY_THEME_MAPPING[family];
    return Array.isArray(themes) && themes.length > 0;
  });
}
